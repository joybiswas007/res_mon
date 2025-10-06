# res_mon

A real-time system monitoring dashboard with WebSocket support. Monitor CPU, memory, disk usage, and running processes through a clean web interface.

## Features

- Real-time system metrics via WebSocket
- Memory usage tracking with progress bars
- Disk partition monitoring
- Top processes display with CPU and memory details
- System information (hostname, uptime, load average)
- Multiple theme options
- Responsive design

## Themes

The dashboard includes five built-in themes:

- Glassmorphism
- Cyberpunk
- Neo-Brutalist
- Terminal
- htop

## Requirements

- Go 1.24+
- Modern web browser with WebSocket support

## Installation

Clone the repository:

```
git clone https://github.com/joybiswas007/res_mon.git
cd res_mon
```

Install dependencies:

```
go mod tidy
```

## Usage

Run the server:

```
go run main.go
```

The dashboard will be available at `http://localhost:8080`

## Configuration

The server listens on port 8080 by default. You can change this by modifying the port in the main.go file.

## License

MIT License

## Contributing

Contributions are welcome. Please open an issue or submit a pull request.
