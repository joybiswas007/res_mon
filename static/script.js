const ws = new WebSocket("ws://127.0.0.1:8080/ws");
const statusEl = document.getElementById("connection-status");
const statusTextEl = statusEl.querySelector(".status-text");
const messagesEl = document.getElementById("messages");
const partitionsListEl = document.getElementById("partitions-list");
const partitionCountEl = document.getElementById("partition-count");

// Theme Dropdown
const themeBtn = document.getElementById("theme-btn");
const themeMenu = document.getElementById("theme-menu");
const themeOptions = document.querySelectorAll(".theme-option");
const themeStylesheet = document.getElementById("theme-style");

// Load saved theme from localStorage
const savedTheme = localStorage.getItem("monitor-theme") || "cyber";
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
    localStorage.setItem("monitor-theme", theme);
    themeMenu.classList.remove("show");
  });
});

function formatBytes(bytes) {
  return (bytes / 1024 ** 3).toFixed(2);
}

function updateMemoryDisplay(memory) {
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
}

function updateLoadDisplay(loadAvg) {
  document.getElementById("load-1").textContent = loadAvg.load1.toFixed(2);
  document.getElementById("load-5").textContent = loadAvg.load5.toFixed(2);
  document.getElementById("load-15").textContent = loadAvg.load15.toFixed(2);
}

function updatePartitionsDisplay(partitions) {
  if (!partitions || partitions.length === 0) {
    partitionsListEl.innerHTML =
      '<div class="no-partitions">No partitions detected</div>';
    partitionCountEl.textContent = "0 partitions";
    return;
  }

  partitionCountEl.textContent =
    partitions.length + " partition" + (partitions.length !== 1 ? "s" : "");

  const template = partitionsListEl.querySelector('[data-template="true"]');
  const existingCards = partitionsListEl.querySelectorAll(
    '.partition-card:not([data-template="true"])',
  );
  existingCards.forEach((card) => card.remove());

  partitions.forEach((partition) => {
    const card = template.cloneNode(true);
    card.removeAttribute("data-template");
    card.style.display = "";

    const usedPercent = partition.usedPercent.toFixed(1);

    card.classList.remove("healthy", "warning", "critical");
    if (usedPercent >= 90) {
      card.classList.add("critical");
    } else if (usedPercent >= 75) {
      card.classList.add("warning");
    } else {
      card.classList.add("healthy");
    }

    card.querySelector(".partition-device").textContent = partition.device;
    card.querySelector(".partition-mount").textContent = partition.mountpoint;
    card.querySelector(".partition-type").textContent = partition.fstype;
    card.querySelector(".usage-percent").textContent = usedPercent + "%";
    card.querySelector(".partition-progress-fill").style.width =
      usedPercent + "%";
    card.querySelector(".stat-used").textContent =
      formatBytes(partition.used) + " GB";
    card.querySelector(".stat-free").textContent =
      formatBytes(partition.free) + " GB";
    card.querySelector(".stat-total").textContent =
      formatBytes(partition.total) + " GB";

    partitionsListEl.appendChild(card);
  });
}

ws.onopen = function (event) {
  statusTextEl.textContent = "Connected";
  statusEl.className = "status connected";
  messagesEl.textContent +=
    "[" + new Date().toLocaleTimeString() + "] Connected to server\n";
};

ws.onmessage = function (event) {
  try {
    const data = JSON.parse(event.data);

    if (data.memory) {
      updateMemoryDisplay(data.memory);
    }

    if (data.load_average) {
      updateLoadDisplay(data.load_average);
    }

    if (data.partitions) {
      updatePartitionsDisplay(data.partitions);
    }

    messagesEl.textContent +=
      "[" + new Date().toLocaleTimeString() + "] Data received\n";
    messagesEl.scrollTop = messagesEl.scrollHeight;
  } catch (e) {
    messagesEl.textContent +=
      "[" +
      new Date().toLocaleTimeString() +
      "] Error parsing data: " +
      e.message +
      "\n";
  }
};

ws.onclose = function (event) {
  statusTextEl.textContent = "Disconnected";
  statusEl.className = "status disconnected";
  messagesEl.textContent +=
    "[" + new Date().toLocaleTimeString() + "] Disconnected from server\n";
};

ws.onerror = function (error) {
  messagesEl.textContent +=
    "[" + new Date().toLocaleTimeString() + "] WebSocket error occurred\n";
};
