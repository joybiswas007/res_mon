package main

import (
	"context"
	"embed"
	"errors"
	"fmt"
	"html/template"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sort"
	"sync"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/host"
	"github.com/shirou/gopsutil/v4/load"
	"github.com/shirou/gopsutil/v4/mem"
	"github.com/shirou/gopsutil/v4/process"
)

// Embed the entire "static" directory, which includes assets
//
//go:embed "static"
var embeddedFiles embed.FS

type application struct {
	port int
	wg   sync.WaitGroup
}

func main() {
	app := &application{
		port: 8080,
	}

	err := app.serve()
	if err != nil {
		log.Fatal(err)
	}
}

func (app *application) routes() http.Handler {
	r := http.NewServeMux()

	staticFS, err := fs.Sub(embeddedFiles, "static")
	if err != nil {
		log.Fatal(err)
	}

	r.Handle("/static/", http.StripPrefix("/static", http.FileServer(http.FS(staticFS))))
	r.HandleFunc("/", app.serveHTMLHandler)
	r.HandleFunc("/ws", app.wsHandler)

	return r
}

func (app *application) serveHTMLHandler(w http.ResponseWriter, r *http.Request) {
	tmpl, err := template.ParseFS(embeddedFiles, "static/index.html")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	err = tmpl.Execute(w, nil)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
}

func (app *application) wsHandler(w http.ResponseWriter, r *http.Request) {
	upgrader := websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
		CheckOrigin:     func(r *http.Request) bool { return true },
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer conn.Close()

	hostname, err := os.Hostname()
	if err != nil {
		sendClose(conn, err)
		return
	}

	// Helper function to gather and send resource info
	sendSnapshot := func() error {
		uptime, err := host.Uptime()
		if err != nil {
			return err
		}

		v, err := mem.VirtualMemory()
		if err != nil {
			return err
		}

		avg, err := load.Avg()
		if err != nil {
			return err
		}

		partitions, err := disk.Partitions(false)
		if err != nil {
			return err
		}

		var diskPartitions []DiskPartition
		for _, partition := range partitions {
			usage, err := disk.Usage(partition.Mountpoint)
			if err != nil {
				continue
			}
			diskPartitions = append(diskPartitions, DiskPartition{
				Device:      partition.Device,
				Mountpoint:  partition.Mountpoint,
				Fstype:      partition.Fstype,
				Total:       usage.Total,
				Used:        usage.Used,
				Free:        usage.Free,
				UsedPercent: usage.UsedPercent,
			})
		}

		processes, err := process.Processes()
		if err != nil {
			return err
		}

		var processInfos []ProcessInfo
		for _, p := range processes {
			name, err := p.Name()
			if err != nil {
				continue
			}

			cpuPercent, _ := p.CPUPercent()
			memInfo, err := p.MemoryInfo()
			if err != nil {
				continue
			}

			cmdLine, _ := p.Cmdline()
			memPercent, _ := p.MemoryPercent()
			status, _ := p.Status()
			username, _ := p.Username()

			processInfos = append(processInfos, ProcessInfo{
				PID:           p.Pid,
				Name:          name,
				CPUPercent:    cpuPercent,
				MemoryMB:      float64(memInfo.RSS) / 1024 / 1024,
				MemoryPercent: memPercent,
				Status:        firstOrEmpty(status),
				Username:      username,
				Cmdline:       cmdLine,
			})
		}

		sort.Slice(processInfos, func(i, j int) bool {
			return processInfos[i].CPUPercent > processInfos[j].CPUPercent
		})

		rs := Resources{
			Hostname: hostname,
			Uptime:   uptime,
			Memory: Memory{
				Total:       v.Total,
				Free:        v.Free,
				Used:        v.Used,
				UsedPercent: v.UsedPercent,
				Available:   v.Available,
			},
			LoadAverage: LoadAverage{
				Load1:  avg.Load1,
				Load5:  avg.Load5,
				Load15: avg.Load15,
			},
			Partitions: diskPartitions,
			Processes:  processInfos,
		}

		return conn.WriteJSON(rs)
	}

	// Send the first snapshot immediately
	if err := sendSnapshot(); err != nil {
		sendClose(conn, err)
		return
	}

	// Loop every second (1s delay after each send)
	for {
		select {
		case <-r.Context().Done():
			log.Println("client disconnected")
			return
		case <-time.After(1 * time.Second):
			if err := sendSnapshot(); err != nil {
				sendClose(conn, err)
				return
			}
		}
	}
}

// sendClose sends a proper close message
func sendClose(conn *websocket.Conn, err error) {
	_ = conn.WriteMessage(websocket.CloseMessage,
		websocket.FormatCloseMessage(websocket.CloseInternalServerErr, err.Error()))
}

// helper to safely extract first rune from process.Status()
func firstOrEmpty(s []string) string {
	if len(s) > 0 {
		return s[0]
	}
	return ""
}

func (app *application) serve() error {
	srv := &http.Server{
		Addr:         fmt.Sprintf(":%d", app.port),
		Handler:      app.routes(),
		IdleTimeout:  time.Minute,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 30 * time.Second,
	}

	// Create a shutdownError channel. We will use this to receive any errors returned
	// by the graceful Shutdown() function.
	shutdownError := make(chan error)

	// Start a background goroutine.
	go func() {
		// Create a quit channel which carries os.Signal values.
		quit := make(chan os.Signal, 1)

		// Use signal.Notify() to listen for incoming SIGINT and SIGTERM signals and
		// relay them to the quit channel. Any other signals will not be caught by
		// signal.Notify() and will retain their default behavior.
		signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

		// Read the signal from the quit channel. This code will block until a signal is
		// received.
		s := <-quit

		log.Printf("shutting down server: %s", s.String())

		// Create a context with a 20-second timeout.
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()

		// Call Shutdown() on the server like before, but now we only send on the
		// shutdownError channel if it returns an error.
		err := srv.Shutdown(ctx)
		if err != nil {
			shutdownError <- err
		}

		// Log a message to say that we're waiting for any background goroutines to
		// complete their tasks.
		log.Printf("completing background tasks: %s", srv.Addr)

		// Call Wait() to block until our WaitGroup counter is zero --- essentially
		// blocking until the background goroutines have finished. Then we return nil on
		// the shutdownError channel, to indicate that the shutdown completed without
		// any issues.
		app.wg.Wait()
		shutdownError <- nil
	}()

	log.Printf("starting server: %s", srv.Addr)

	// Calling Shutdown() on our server will cause ListenAndServe() to immediately
	// return a http.ErrServerClosed error. So if we see this error, it is actually a
	// good thing and an indication that the graceful shutdown has started. So we check
	// specifically for this, only returning the error if it is NOT http.ErrServerClosed.
	err := srv.ListenAndServe()
	if errors.Is(err, http.ErrServerClosed) {
		return err
	}

	err = <-shutdownError
	if err != nil {
		return err
	}

	// At this point we know that the graceful shutdown completed successfully and we
	// log a "stopped server" message.
	log.Printf("stopped server: %s", srv.Addr)

	return nil
}

type Memory struct {
	// Total amount of RAM on this system
	Total uint64 `json:"total"`

	// RAM available for programs to allocate
	Available uint64 `json:"available"`

	// RAM used by programs
	Used uint64 `json:"used"`

	// Percentage of RAM used by programs
	UsedPercent float64 `json:"usedPercent"`

	// This is the kernel's notion of free memory;
	Free uint64 `json:"free"`
}
type LoadAverage struct {
	Load1  float64 `json:"load1"`  // Average over the last 1 minute
	Load5  float64 `json:"load5"`  // Average over the last 5 minutes
	Load15 float64 `json:"load15"` // Average over the last 15 minutes
}
type Disk struct {
	Total       uint64  `json:"total"`
	Used        uint64  `json:"used"`
	Free        uint64  `json:"free"`
	UsedPercent float64 `json:"usedPercent"`
}

type DiskPartition struct {
	Device      string  `json:"device"`
	Mountpoint  string  `json:"mountpoint"`
	Fstype      string  `json:"fstype"`
	Total       uint64  `json:"total"`
	Used        uint64  `json:"used"`
	Free        uint64  `json:"free"`
	UsedPercent float64 `json:"usedPercent"`
}

type ProcessInfo struct {
	PID           int32   `json:"pid"`
	Name          string  `json:"name"`
	CPUPercent    float64 `json:"cpuPercent"`
	MemoryMB      float64 `json:"memoryMB"`
	MemoryPercent float32 `json:"memoryPercent"`
	Status        string  `json:"status"`
	Username      string  `json:"username"`
	Cmdline       string  `json:"cmdline"`
}

type Resources struct {
	Hostname    string          `json:"hostname"`
	Uptime      uint64          `json:"uptime"`
	Memory      Memory          `json:"memory"`
	LoadAverage LoadAverage     `json:"load_average"`
	Partitions  []DiskPartition `json:"partitions"`
	Processes   []ProcessInfo   `json:"processes"`
}
