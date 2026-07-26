/* 97 Sender — popup: live run status + pause / resume / stop. */
function send(msg) { return new Promise(function (r) { try { chrome.runtime.sendMessage(msg, function (res) { void chrome.runtime.lastError; r(res || {}); }); } catch (_) { r({}); } }); }

async function waStatus() {
  var tabs = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
  var el = document.getElementById("wa");
  if (tabs && tabs.length) { el.textContent = "WhatsApp Web is open ✓"; el.className = "pill on"; }
  else { el.textContent = "Open web.whatsapp.com to send"; el.className = "pill"; }
}

function control(action) { send({ type: "control", action: action }).then(render); }

async function render() {
  await waStatus();
  var res = await send({ type: "status" });
  var run = res.run, daily = res.daily || 0;
  var c = document.getElementById("content");

  if (!run) {
    c.innerHTML = '<div class="stat"><span>Sent today</span><b>' + daily + '</b></div>' +
      '<div class="idle" style="margin-top:8px">No run in progress. Queue reminders from the 97 LIVE dashboard, then choose <b>Auto</b>.</div>';
    return;
  }

  var total = run.jobs.length, done = run.done || 0, at = Math.min(run.idx + 1, total);
  var pct = Math.round((run.idx / Math.max(1, total)) * 100);
  c.innerHTML =
    '<div class="stat"><span>Progress</span><b>' + at + ' / ' + total + '</b></div>' +
    '<div class="bar"><i style="width:' + pct + '%"></i></div>' +
    '<div class="stat"><span>Sent this run</span><b>' + done + '</b></div>' +
    '<div class="stat"><span>Sent today</span><b>' + daily + '</b></div>' +
    '<div class="stat"><span>Status</span><b>' + (run.paused ? "Paused" : "Sending…") + '</b></div>' +
    '<div class="row">' +
      (run.paused
        ? '<button onclick="control(\'resume\')">Resume</button>'
        : '<button onclick="control(\'pause\')">Pause</button>') +
      '<button class="stop" onclick="control(\'stop\')">Stop</button>' +
    '</div>';
}

window.control = control;
render();
setInterval(render, 1500);
