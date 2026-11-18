// Renders the UniFi cards of this fork with mock data (a Cloud Gateway Ultra) and saves the README screenshots:
// screenshots/unifi-card(-dark).png and screenshots/unifi-mini-card(-dark).png.
// Usage: npm run build && npm run screenshots:unifi
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { saveIfChanged } from "./capture.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const cardJs = readFileSync(`${root}dist/internet-box-card.js`, "utf8");
const NOW = "2026-11-18T12:00:00Z";

// A UniFi gateway as the UniFi Network integration exposes it, with a few clients and a Speedtest.net result.
const mock = () => {
  const states = {};
  const entities = {};
  const devices = { gw: { id: "gw", name: "Gateway", model: "UDRULT", sw_version: "4.3.9", config_entries: ["entry"] } };
  const add = (platform, id, key, state, attributes = {}, device = "gw") => {
    states[id] = { entity_id: id, state, attributes, last_changed: "2026-11-18T06:00:00Z", last_updated: "2026-11-18T06:00:00Z" };
    entities[id] = { entity_id: id, platform, device_id: device, ...(key ? { translation_key: key } : {}) };
  };
  add("unifi", "sensor.gateway_state", "device_state", "connected", { device_class: "enum" });
  add("unifi", "sensor.gateway_uptime", null, "2026-10-30T09:00:00+00:00", { device_class: "uptime" });
  add("unifi", "sensor.gateway_cpu_utilization", "device_cpu_utilization", "23", { unit_of_measurement: "%" });
  add("unifi", "sensor.gateway_memory_utilization", "device_memory_utilization", "61", { unit_of_measurement: "%" });
  add("unifi", "sensor.gateway_cpu_temperature", "device_sub_temperature", "48.3", {
    unit_of_measurement: "°C", device_class: "temperature", friendly_name: "Gateway CPU temperature",
  });
  add("unifi", "sensor.gateway_cloudflare_wan_latency", "wan_latency", "8", {
    unit_of_measurement: "ms", device_class: "duration", friendly_name: "Gateway Cloudflare WAN latency",
  });
  add("unifi", "sensor.gateway_google_wan_latency", "wan_latency", "11", {
    unit_of_measurement: "ms", device_class: "duration", friendly_name: "Gateway Google WAN latency",
  });
  add("unifi", "button.gateway_restart", null, "unknown", { device_class: "restart" });
  add("unifi", "sensor.gateway_port_9_rx", "port_bandwidth_rx", "495", {
    unit_of_measurement: "Mbit/s", device_class: "data_rate", friendly_name: "Gateway WAN RX",
  });
  add("unifi", "sensor.gateway_port_9_tx", "port_bandwidth_tx", "34", {
    unit_of_measurement: "Mbit/s", device_class: "data_rate", friendly_name: "Gateway WAN TX",
  });
  for (const name of ["laptop", "phone", "tablet", "tv", "printer"]) {
    devices[`dev_${name}`] = { id: `dev_${name}`, name, config_entries: ["entry"] };
    add("unifi", `device_tracker.${name}`, null, name === "printer" ? "not_home" : "home", { source_type: "router" }, `dev_${name}`);
  }
  add("speedtestdotnet", "sensor.speedtest_download", "download", "912.4", { unit_of_measurement: "Mbit/s" }, null);
  add("speedtestdotnet", "sensor.speedtest_upload", "upload", "48.7", { unit_of_measurement: "Mbit/s" }, null);
  add("speedtestdotnet", "sensor.speedtest_ping", "ping", "9.4", { unit_of_measurement: "ms" }, null);
  return { states, entities, devices };
};

const THEMES = {
  light: "--primary-background-color:#e8eaed;--secondary-background-color:#ececec;--card-background-color:#fff;--primary-text-color:#212121;--secondary-text-color:#727272;--divider-color:rgba(0,0,0,.12);",
  dark: "--primary-background-color:#111;--secondary-background-color:#282828;--card-background-color:#1c1c1c;--primary-text-color:#e1e1e1;--secondary-text-color:#9b9b9b;--divider-color:rgba(225,225,225,.12);",
};

const HA_CARD = `customElements.define("ha-card", class extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" }).innerHTML =
      "<style>:host{display:block;background:var(--card-background-color);border-radius:12px;" +
      "border:1px solid var(--divider-color);color:var(--primary-text-color);overflow:hidden}</style><slot></slot>";
  }
});`;

const shots = [
  { file: "unifi-card", type: "unifi-box-card", theme: "light", width: 460 },
  { file: "unifi-card-dark", type: "unifi-box-card", theme: "dark", width: 460 },
  { file: "unifi-mini-card", type: "unifi-box-mini-card", theme: "light", width: 380 },
  { file: "unifi-mini-card-dark", type: "unifi-box-mini-card", theme: "dark", width: 380 },
];

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
for (const s of shots) {
  const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1000, height: 2000 } });
  page.on("pageerror", (err) => console.error(`${s.file}: ${err.message}`));
  await page.clock.setFixedTime(new Date(NOW));
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>:root{${THEMES[s.theme]}}
    body{margin:0;padding:16px;background:var(--primary-background-color);color:var(--primary-text-color);
    font-family:Roboto,"Segoe UI",Helvetica,Arial,sans-serif;width:${s.width}px}</style></head><body><div id="root"></div></body></html>`);
  await page.addScriptTag({ content: HA_CARD });
  await page.addScriptTag({ content: cardJs });
  await page.evaluate(
    ({ type, dark, data }) => {
      const el = document.createElement(type);
      el.setConfig({ type: `custom:${type}` });
      // Recorder statistics: 24 h of 5-minute rows per sensor, a calm night and a busy evening.
      const row = (t0, k) => (_, i) => {
        const evening = Math.exp(-((i - 220 - 15 * k) ** 2) / 1000);
        const noon = Math.exp(-((i - 140) ** 2) / 500);
        return { start: t0 + i * 300000, mean: 15 + 70 * evening + 30 * noon + 6 * Math.cos(i * 0.1 + k) ** 2 };
      };
      const callWS = async ({ statistic_ids: ids = [], start_time: from }) =>
        Object.fromEntries(ids.map((id, k) => [id, Array.from({ length: 288 }, row(Date.parse(from), k))]));
      el.hass = { ...data, language: "en", locale: { language: "en" }, config: { time_zone: "UTC" }, callWS, themes: { darkMode: dark } };
      document.getElementById("root").appendChild(el);
    },
    { type: s.type, dark: s.theme === "dark", data: mock() }
  );
  await page.waitForTimeout(800);
  const box = await page.locator("#root").boundingBox();
  const tmp = join(tmpdir(), `ubc-${process.pid}-${s.file}.png`);
  await page.screenshot({ path: tmp, clip: { x: 0, y: 0, width: s.width + 32, height: Math.ceil(box.height) + 32 }, animations: "disabled" });
  console.log(`screenshots/${s.file}.png${saveIfChanged(tmp, `${root}screenshots/${s.file}.png`) ? "" : " (unchanged)"}`);
  await page.close();
}
await browser.close();
