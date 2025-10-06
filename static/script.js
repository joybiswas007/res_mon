// Dynamic WebSocket URL construction
const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
const wsUrl = `${protocol}//${window.location.host}/ws`;
const ws = new WebSocket(wsUrl);

const statusEl = document.getElementById("connection-status");
const statusTextEl = statusEl.querySelector(".status-text");
const hostnameEl = document.getElementById("hostname");
const uptimeEl = document.getElementById("uptime");
const messagesEl = document.getElementById("messages");
const partitionsCompactEl = document.getElementById("partitions-compact");
const partitionCountEl = document.getElementById("partition-count");
const processesTbodyEl = document.getElementById("processes-tbody");
const processCountEl = document.getElementById("process-count");

// Theme Dropdown
const themeBtn = document.getElementById("theme-btn");
const themeMenu = document.getElementById("theme-menu");
const themeOptions = document.querySelectorAll(".theme-option");
const themeStylesheet = document.getElementById("theme-style");

// Load saved theme from localStorage
const savedTheme = localStorage.getItem("res_mon-theme") || "terminal";
themeStylesheet.href = `/static/styles/${savedTheme}.css`;

// Toggle dropdown
themeBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  themeMenu.classList.toggle("show");
});

// Close dropdown when clicking outside
document.addEventListener("click", () => {
  themeMenu.classList.remove("show");
});

// Theme switcher event listeners
themeOptions.forEach((option) => {
  option.addEventListener("click", (e) => {
    e.stopPropagation();
    const theme = option.dataset.theme;
    themeStylesheet.href = `/static/styles/${theme}.css`;
    localStorage.setItem("res_mon-theme", theme);
    themeMenu.classList.remove("show");
  });
});

function formatBytes(bytes) {
  return (bytes / 1024 ** 3).toFixed(2);
}

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

  return parts.join(" ");
}

function truncateCommand(cmd, maxLength = 70) {
  if (cmd.length <= maxLength) return cmd;
  return cmd.substring(0, maxLength) + "...";
}

// Throttle log messages to prevent spam
let logQueue = [];
let logTimer = null;

function logMessage(message, type = "info") {
  const timestamp = new Date().toLocaleTimeString();
  const prefix = type === "error" ? "[ERROR]" : "[INFO]";
  logQueue.push(`[${timestamp}] ${prefix} ${message}`);

  if (!logTimer) {
    logTimer = setTimeout(() => {
      const fragment = document.createDocumentFragment();
      const textNode = document.createTextNode(logQueue.join("\n") + "\n");
      fragment.appendChild(textNode);
      messagesEl.appendChild(fragment);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      logQueue = [];
      logTimer = null;
    }, 100);
  }
}

function updateSystemInfo(hostname, uptime) {
  requestAnimationFrame(() => {
    document.title = `${hostname} - Resources Monitor`;
    hostnameEl.textContent = hostname;
    uptimeEl.textContent = formatUptime(uptime);
  });
}

function updateMemoryDisplay(memory) {
  requestAnimationFrame(() => {
    document.getElementById("memory-percent").textContent =
      memory.usedPercent.toFixed(1);
    document.getElementById("memory-used").textContent =
      formatBytes(memory.used) + " GB";
    document.getElementById("memory-available").textContent =
      formatBytes(memory.available) + " GB";
    document.getElementById("memory-total").textContent =
      formatBytes(memory.total) + " GB";
    document.getElementById("memory-progress").style.width =
      memory.usedPercent.toFixed(1) + "%";
  });
}

function updateLoadDisplay(loadAvg) {
  requestAnimationFrame(() => {
    document.getElementById("load-1").textContent = loadAvg.load1.toFixed(2);
    document.getElementById("load-5").textContent = loadAvg.load5.toFixed(2);
    document.getElementById("load-15").textContent = loadAvg.load15.toFixed(2);
  });
}

function updatePartitionsDisplay(partitions) {
  requestAnimationFrame(() => {
    if (!partitions || partitions.length === 0) {
      partitionsCompactEl.innerHTML =
        '<div class="no-partitions">No partitions detected</div>';
      partitionCountEl.textContent = "0";
      return;
    }

    partitionCountEl.textContent = partitions.length;

    const template = partitionsCompactEl.querySelector(
      '[data-template="true"]',
    );
    const existingItems = partitionsCompactEl.querySelectorAll(
      '.partition-compact-item:not([data-template="true"])',
    );
    existingItems.forEach((item) => item.remove());

    const fragment = document.createDocumentFragment();

    partitions.forEach((partition) => {
      const item = template.cloneNode(true);
      item.removeAttribute("data-template");
      item.style.display = "";

      const usedPercent = partition.usedPercent.toFixed(1);

      item.classList.remove("healthy", "warning", "critical");
      if (usedPercent >= 90) {
        item.classList.add("critical");
      } else if (usedPercent >= 75) {
        item.classList.add("warning");
      } else {
        item.classList.add("healthy");
      }

      item.querySelector(".partition-compact-name").textContent =
        partition.device;
      item.querySelector(".partition-compact-percent").textContent =
        usedPercent + "%";
      item.querySelector(".partition-compact-bar-fill").style.width =
        usedPercent + "%";
      item.querySelector(".partition-compact-size").textContent =
        `${formatBytes(partition.used)} GB / ${formatBytes(partition.total)} GB`;

      fragment.appendChild(item);
    });

    partitionsCompactEl.appendChild(fragment);
  });
}

function updateProcessesDisplay(processes) {
  requestAnimationFrame(() => {
    if (!processes || processes.length === 0) {
      processesTbodyEl.innerHTML =
        '<tr><td colspan="7" class="no-processes">No processes detected</td></tr>';
      processCountEl.textContent = "0 processes";
      return;
    }

    processCountEl.textContent =
      processes.length + " process" + (processes.length !== 1 ? "es" : "");

    const fragment = document.createDocumentFragment();

    processes.forEach((proc) => {
      const row = document.createElement("tr");

      // PID
      const pidCell = document.createElement("td");
      pidCell.textContent = proc.pid;
      row.appendChild(pidCell);

      // Name
      const nameCell = document.createElement("td");
      nameCell.textContent = proc.name;
      nameCell.className = "process-name";
      row.appendChild(nameCell);

      // CPU %
      const cpuCell = document.createElement("td");
      cpuCell.textContent = proc.cpuPercent.toFixed(1) + "%";
      cpuCell.className = "process-cpu";
      if (proc.cpuPercent > 50) {
        cpuCell.classList.add("high-usage");
      }
      row.appendChild(cpuCell);

      // Memory
      const memCell = document.createElement("td");
      memCell.textContent = proc.memoryMB.toFixed(1) + " MB";
      memCell.className = "process-memory";
      row.appendChild(memCell);

      // Status
      const statusCell = document.createElement("td");
      statusCell.textContent = proc.status;
      statusCell.className = "process-status";
      row.appendChild(statusCell);

      // User
      const userCell = document.createElement("td");
      userCell.textContent = proc.username || "N/A";
      userCell.className = "process-user";
      row.appendChild(userCell);

      // Command Line
      const cmdCell = document.createElement("td");
      cmdCell.textContent = truncateCommand(proc.cmdline || proc.name);
      cmdCell.className = "process-cmd";
      cmdCell.title = proc.cmdline; // Full command on hover
      row.appendChild(cmdCell);

      fragment.appendChild(row);
    });

    processesTbodyEl.innerHTML = "";
    processesTbodyEl.appendChild(fragment);
  });
}

ws.onopen = function (event) {
  statusTextEl.textContent = "Connected";
  statusEl.className = "status connected";
  logMessage("Connected to server");
};

ws.onmessage = function (event) {
  try {
    const data = JSON.parse(event.data);

    // Check if server sent an error
    if (data.error) {
      logMessage(data.error, "error");
      return;
    }

    if (data.hostname && data.uptime !== undefined) {
      updateSystemInfo(data.hostname, data.uptime);
    }

    if (data.memory) {
      updateMemoryDisplay(data.memory);
    }

    if (data.load_average) {
      updateLoadDisplay(data.load_average);
    }

    if (data.partitions) {
      updatePartitionsDisplay(data.partitions);
    }

    if (data.processes) {
      updateProcessesDisplay(data.processes);
    }
  } catch (e) {
    logMessage("Error parsing data: " + e.message, "error");
  }
};

ws.onclose = function (event) {
  statusTextEl.textContent = "Disconnected";
  statusEl.className = "status disconnected";
  if (event.reason) {
    logMessage("Disconnected: " + event.reason, "error");
  } else {
    logMessage("Disconnected from server", "error");
  }
};

ws.onerror = function () {
  logMessage("WebSocket connection error", "error");
};
