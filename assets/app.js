/* Gestione Veicolo — Scadenze & Tariffe (GitHub Pages, no backend)
   Funzioni:
   - Tema a 4 colori (persistente in LocalStorage)
   - Datalist veicoli (suggerimenti) + input libero
   - Select regioni → tariffa auto-compilata (lookup)
   - Scadenze: Bollo / Revisione / Assicurazione (date) + Tagliando (15.000 km o 12 mesi)
   - Soglie avvisi: 30 giorni / 1000 km (modificabili)
   - Semaforo globale + indicatori riga
   - Fallback embedded se i JSON non si caricano (evita blocchi)
*/

(() => {
  "use strict";

  // ====== Costanti ======
  const STORAGE_KEYS = {
    THEME: "vehapp.theme",
    SETTINGS: "vehapp.settings",  // {thresholdDays, thresholdKm}
    DATA: "vehapp.data"           // tutti i campi del veicolo e scadenze
  };

  const SERVICE_KM_INTERVAL = 15000; // 15.000 km
  const SERVICE_MONTHS_INTERVAL = 12; // 12 mesi

  // ====== Elementi DOM ======
  const $ = (q) => document.querySelector(q);

  // Tema & soglie
  const themeButtons = document.querySelectorAll(".btn.theme");
  const bodyEl = document.body;
  const thresholdDaysInput = $("#thresholdDays");
  const thresholdKmInput = $("#thresholdKm");

  // Veicolo & Regione
  const vehicleForm = $("#vehicleForm");
  const vehicleInput = $("#vehicleInput");
  const vehiclesList = $("#vehiclesList");
  const regionSelect = $("#regionSelect");
  const tariffInput = $("#tariffInput");
  const vehicleErrors = $("#vehicleErrors");

  // Manutenzioni & Scadenze
  const maintenanceForm = $("#maintenanceForm");
  const currentKm = $("#currentKm");
  const lastServiceDate = $("#lastServiceDate");
  const lastServiceKm = $("#lastServiceKm");
  const expiryBollo = $("#expiryBollo");
  const expiryRevisione = $("#expiryRevisione");
  const expiryAssicurazione = $("#expiryAssicurazione");
  const maintErrors = $("#maintErrors");

  // Stato tabella & globale
  const statusBody = $("#statusBody");
  const globalStatusBar = $("#globalStatus");
  const globalStatusText = $("#globalStatusText");

  // Toast
  const toast = $("#toast");
  const showToast = (msg, ms = 1600) => {
    toast.textContent = msg;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), ms);
  };

  // ====== Dati runtime ======
  let regions = [];
  let vehicles = [];
  let regionMap = new Map();

  // Fallback embedded
  const EMBED_VEHICLES = [
    "Fiat Panda","Volkswagen Golf 7.5","Volkswagen Golf","Volkswagen Passat B6",
    "Renault Clio","Ford Fiesta","Toyota Yaris","Audi A3","BMW Serie 1","Opel Corsa",
    "Peugeot 208","Citroën C3","Dacia Duster","Nissan Qashqai","Hyundai i20","Kia Sportage",
    "Seat Ibiza","Skoda Octavia","Alfa Romeo Giulietta","Lancia Ypsilon"
  ];
  const EMBED_REGIONS = [
    {"regione":"Abruzzo","tariffa":100},{"regione":"Basilicata","tariffa":95},
    {"regione":"Calabria","tariffa":90},{"regione":"Campania","tariffa":110},
    {"regione":"Emilia-Romagna","tariffa":130},{"regione":"Friuli-Venezia Giulia","tariffa":120},
    {"regione":"Lazio","tariffa":140},{"regione":"Liguria","tariffa":125},{"regione":"Lombardia","tariffa":150},
    {"regione":"Marche","tariffa":115},{"regione":"Molise","tariffa":85},{"regione":"Piemonte","tariffa":135},
    {"regione":"Puglia","tariffa":105},{"regione":"Sardegna","tariffa":100},{"regione":"Sicilia","tariffa":100},
    {"regione":"Toscana","tariffa":145},{"regione":"Trentino-Alto Adige","tariffa":130},{"regione":"Umbria","tariffa":110},
    {"regione":"Valle d'Aosta","tariffa":125},{"regione":"Veneto","tariffa":140}
  ];

  // ====== Utils ======
  const normalize = (s) =>
    (s ?? "")
      .toString()
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/\s+/g, " ");

  const safeFetchJson = async (path, fallback) => {
    try {
      const res = await fetch(path, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch {
      return fallback;
    }
  };

  const fmtDate = (d) => {
    try {
      const date = d instanceof Date ? d : new Date(d);
      if (isNaN(date)) return "";
      return date.toLocaleDateString(undefined, { year:"numeric", month:"2-digit", day:"2-digit" });
    } catch { return ""; }
  };

  const addMonthsSafe = (date, months) => {
    const d = new Date(date.getTime());
    const targetMonth = d.getMonth() + months;
    d.setMonth(targetMonth);
    if (d.getMonth() !== ((targetMonth % 12) + 12) % 12) d.setDate(0); // fine mese
    return d;
  };

  const diffDays = (from, to) => {
    const MS = 24*60*60*1000;
    const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
    return Math.floor((b - a) / MS);
  };

  const toInt = (v) => {
    if (v === null || v === undefined) return NaN;
    const n = parseInt(String(v).replace(/\./g, ""), 10);
    return Number.isFinite(n) ? n : NaN;
  };

  // ====== Persistenza ======
  const saveSettings = (obj) => {
    try { localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(obj)); } catch {}
  };
  const loadSettings = () => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.SETTINGS)) || null; } catch { return null; }
  };

  const saveTheme = (theme) => {
    try { localStorage.setItem(STORAGE_KEYS.THEME, theme); } catch {}
  };
  const loadTheme = () => {
    try { return localStorage.getItem(STORAGE_KEYS.THEME) || ""; } catch { return ""; }
  };

  const saveData = (obj) => {
    try { localStorage.setItem(STORAGE_KEYS.DATA, JSON.stringify(obj)); } catch {}
  };
  const loadData = () => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.DATA)) || null; } catch { return null; }
  };

  // ====== Tema ======
  const THEMES = ["pink","green","blue","white"];
  const applyTheme = (theme) => {
    // rimuovi temi precedenti
    THEMES.forEach(t => bodyEl.classList.remove(`theme-${t}`));
    if (THEMES.includes(theme)) bodyEl.classList.add(`theme-${theme}`);
  };

  // ====== Popolamento veicoli/regioni ======
  const populateVehicles = (arr) => {
    vehiclesList.innerHTML = "";
    arr.forEach(name => {
      const opt = document.createElement("option");
      opt.value = name;
      vehiclesList.appendChild(opt);
    });
  };

  const populateRegions = (arr) => {
    regionSelect.innerHTML = `<option value="">— Seleziona la regione —</option>`;
    arr.forEach(r => {
      const opt = document.createElement("option");
      opt.value = r.regione;
      opt.textContent = r.regione;
      regionSelect.appendChild(opt);
    });
  };

  const rebuildRegionMap = () => {
    regionMap = new Map();
    regions.forEach(r => regionMap.set(normalize(r.regione), r.tariffa));
  };

  const getTariffByRegion = (label) => {
    const key = normalize(label);
    return regionMap.get(key) ?? null;
  };

  const updateTariff = () => {
    const t = getTariffByRegion(regionSelect.value);
    tariffInput.value = t != null ? t : "";
  };

  // ====== Validazioni base ======
  const validateVehicleRegion = () => {
    const errors = [];
    const vehicle = (vehicleInput.value || "").trim();
    const region = regionSelect.value;

    if (!vehicle) errors.push("Inserisci il veicolo.");
    if (!region) errors.push("Seleziona la regione.");
    if (region && !regionMap.has(normalize(region))) errors.push("Regione non valida: scegli dall'elenco.");
    if (region && !tariffInput.value) errors.push("Tariffa non disponibile per la regione selezionata.");

    vehicleErrors.textContent = errors.join(" ");
    return errors.length === 0;
  };

  const validateMaintenance = () => {
    const errors = [];
    const kmNow = toInt(currentKm.value);
    const lastKm = toInt(lastServiceKm.value);
    const hasDate = !!lastServiceDate.value;

    if (!Number.isFinite(kmNow) || kmNow < 0) errors.push("Inserisci i km attuali (numero ≥ 0).");
    if (!hasDate) errors.push("Inserisci la data dell'ultimo tagliando.");
    if (!Number.isFinite(lastKm) || lastKm < 0) errors.push("Inserisci i km dell'ultimo tagliando (numero ≥ 0).");
    if (Number.isFinite(kmNow) && Number.isFinite(lastKm) && kmNow < lastKm)
      errors.push("I km attuali non possono essere inferiori ai km dell'ultimo tagliando.");

    if (!expiryBollo.value) errors.push("Inserisci la scadenza del Bollo.");
    if (!expiryRevisione.value) errors.push("Inserisci la scadenza della Revisione.");
    if (!expiryAssicurazione.value) errors.push("Inserisci la scadenza dell'Assicurazione.");

    maintErrors.textContent = errors.join(" ");
    return errors.length === 0;
  };

  // ====== Calcoli stati e semafori ======
  const STATUS = { GREEN: "GREEN", YELLOW: "YELLOW", RED: "RED" };
  const worstStatus = (arr) => {
    if (arr.includes(STATUS.RED)) return STATUS.RED;
    if (arr.includes(STATUS.YELLOW)) return STATUS.YELLOW;
    return STATUS.GREEN;
  };

  const badgeHtml = (status, text) => {
    const cls = status === STATUS.RED ? "badge-red" : status === STATUS.YELLOW ? "badge-yellow" : "badge-green";
    return `<span class="badge ${cls}">${text}</span>`;
  };

  const computeRowStatusByDays = (remainDays, thresholdDays) => {
    if (remainDays < 0) return STATUS.RED;
    if (remainDays <= thresholdDays) return STATUS.YELLOW;
    return STATUS.GREEN;
  };

  const computeServiceStatus = (remainKm, remainDays, thresholdKm, thresholdDays) => {
    const kmStatus = (remainKm == null || isNaN(remainKm)) ? STATUS.GREEN
                    : remainKm < 0 ? STATUS.RED
                    : remainKm <= thresholdKm ? STATUS.YELLOW
                    : STATUS.GREEN;
    const dayStatus = (remainDays == null || isNaN(remainDays)) ? STATUS.GREEN
                    : remainDays < 0 ? STATUS.RED
                    : remainDays <= thresholdDays ? STATUS.YELLOW
                    : STATUS.GREEN;
    return worstStatus([kmStatus, dayStatus]);
  };

  const renderStatusTable = () => {
    // carica soglie
    const thresholdDays = toInt(thresholdDaysInput.value) || 30;
    const thresholdKm = toInt(thresholdKmInput.value) || 1000;

    statusBody.innerHTML = "";

    // Se dati non validi, mostra placeholder
    const vehicleOK = validateVehicleRegion();
    const maintOK = validateMaintenance();
    if (!vehicleOK || !maintOK) {
      statusBody.innerHTML = `<tr class="empty"><td colspan="4">Compila i campi sopra per vedere gli stati.</td></tr>`;
      updateGlobalStatus(STATUS.YELLOW, "In attesa dati"); // neutro/giallo fino a validazione
      return;
    }

    // Dati di input
    const kmNow = toInt(currentKm.value);
    const lastKm = toInt(lastServiceKm.value);
    const lastDate = new Date(lastServiceDate.value + "T00:00:00");

    const bolloDate = new Date(expiryBollo.value + "T00:00:00");
    const revisioneDate = new Date(expiryRevisione.value + "T00:00:00");
    const assicurazioneDate = new Date(expiryAssicurazione.value + "T00:00:00");

    const today = new Date();

    // Tagliando
    const nextKm = lastKm + SERVICE_KM_INTERVAL;
    const remainKm = nextKm - kmNow;

    const nextDate = addMonthsSafe(lastDate, SERVICE_MONTHS_INTERVAL);
    const remainDaysService = diffDays(today, nextDate);

    const serviceStatus = computeServiceStatus(remainKm, remainDaysService, thresholdKm, thresholdDays);

    // Altre scadenze (solo giorni)
    const remainDaysBollo = diffDays(today, bolloDate);
    const statusBollo = computeRowStatusByDays(remainDaysBollo, thresholdDays);

    const remainDaysRevisione = diffDays(today, revisioneDate);
    const statusRevisione = computeRowStatusByDays(remainDaysRevisione, thresholdDays);

    const remainDaysAss = diffDays(today, assicurazioneDate);
    const statusAss = computeRowStatusByDays(remainDaysAss, thresholdDays);

    // Render righe
    const rows = [];

    // Tagliando
    const detailService = `Prossimo a ${nextKm.toLocaleString()} km o entro ${fmtDate(nextDate)}`;
    const residuoService =
      `${Number.isFinite(remainKm) ? (remainKm >= 0 ? `tra ${remainKm.toLocaleString()} km` : `sforato di ${Math.abs(remainKm).toLocaleString()} km`) : "-"}`
      + " • "
      + `${Number.isFinite(remainDaysService) ? (remainDaysService >= 0 ? `tra ${remainDaysService} giorni` : `scaduto da ${Math.abs(remainDaysService)} giorni`) : "-"}`;

    rows.push(`
      <tr>
        <td>Tagliando</td>
        <td>${detailService}</td>
        <td>${residuoService}</td>
        <td>${badgeHtml(serviceStatus, serviceStatus === STATUS.RED ? "SCADUTO" : serviceStatus === STATUS.YELLOW ? "IN SCADENZA" : "OK")}</td>
      </tr>
    `);

    // Bollo
    const detailBollo = `Entro ${fmtDate(bolloDate)}`;
    const residuoBollo = remainDaysBollo >= 0 ? `tra ${remainDaysBollo} giorni` : `scaduto da ${Math.abs(remainDaysBollo)} giorni`;
    rows.push(`
      <tr>
        <td>Bollo</td>
        <td>${detailBollo}</td>
        <td>${residuoBollo}</td>
        <td>${badgeHtml(statusBollo, statusBollo === STATUS.RED ? "SCADUTO" : statusBollo === STATUS.YELLOW ? "IN SCADENZA" : "OK")}</td>
      </tr>
    `);

    // Revisione
    const detailRev = `Entro ${fmtDate(revisioneDate)}`;
    const residuoRev = remainDaysRevisione >= 0 ? `tra ${remainDaysRevisione} giorni` : `scaduto da ${Math.abs(remainDaysRevisione)} giorni`;
    rows.push(`
      <tr>
        <td>Revisione</td>
        <td>${detailRev}</td>
        <td>${residuoRev}</td>
        <td>${badgeHtml(statusRevisione, statusRevisione === STATUS.RED ? "SCADUTO" : statusRevisione === STATUS.YELLOW ? "IN SCADENZA" : "OK")}</td>
      </tr>
    `);

    // Assicurazione
    const detailAss = `Entro ${fmtDate(assicurazioneDate)}`;
    const residuoAss = remainDaysAss >= 0 ? `tra ${remainDaysAss} giorni` : `scaduto da ${Math.abs(remainDaysAss)} giorni`;
    rows.push(`
      <tr>
        <td>Assicurazione</td>
        <td>${detailAss}</td>
        <td>${residuoAss}</td>
        <td>${badgeHtml(statusAss, statusAss === STATUS.RED ? "SCADUTO" : statusAss === STATUS.YELLOW ? "IN SCADENZA" : "OK")}</td>
      </tr>
    `);

    statusBody.innerHTML = rows.join("");

    // Semaforo globale
    const global = worstStatus([serviceStatus, statusBollo, statusRevisione, statusAss]);
    const text = global === STATUS.RED ? "Attenzione: qualcosa è scaduto"
              : global === STATUS.YELLOW ? "In scadenza: verifica le date"
              : "Tutto OK";
    updateGlobalStatus(global, text);
  };

  const updateGlobalStatus = (status, text) => {
    globalStatusBar.classList.remove("status-green","status-yellow","status-red");
    const dot = globalStatusBar.querySelector(".dot");
    dot.classList.remove("dot-green","dot-yellow","dot-red");

    if (status === STATUS.RED) {
      globalStatusBar.classList.add("status-red");
      dot.classList.add("dot-red");
    } else if (status === STATUS.YELLOW) {
      globalStatusBar.classList.add("status-yellow");
      dot.classList.add("dot-yellow");
    } else {
      globalStatusBar.classList.add("status-green");
      dot.classList.add("dot-green");
    }
    globalStatusText.textContent = text;
  };

  // ====== Salvataggio automatico ======
  const collectData = () => ({
    vehicle: vehicleInput.value || "",
    region: regionSelect.value || "",
    tariff: tariffInput.value || "",
    currentKm: currentKm.value || "",
    lastServiceDate: lastServiceDate.value || "",
    lastServiceKm: lastServiceKm.value || "",
    expiryBollo: expiryBollo.value || "",
    expiryRevisione: expiryRevisione.value || "",
    expiryAssicurazione: expiryAssicurazione.value || ""
  });

  const applyData = (d) => {
    if (!d) return;
    vehicleInput.value = d.vehicle || "";
    regionSelect.value = d.region || "";
    updateTariff();
    tariffInput.value = d.tariff || "";

    currentKm.value = d.currentKm || "";
    lastServiceDate.value = d.lastServiceDate || "";
    lastServiceKm.value = d.lastServiceKm || "";

    expiryBollo.value = d.expiryBollo || "";
    expiryRevisione.value = d.expiryRevisione || "";
    expiryAssicurazione.value = d.expiryAssicurazione || "";
  };

  const autoSave = () => {
    const data = collectData();
    saveData(data);
  };

  // ====== Event binding ======
  const bindThemeButtons = () => {
    themeButtons.forEach(btn => {
      btn.addEventListener("click", () => {
        const theme = btn.getAttribute("data-theme");
        applyTheme(theme);
        saveTheme(theme);
        showToast(`Tema: ${theme}`);
      });
    });
  };

  const bindInputs = () => {
    // Vehicle/Region
    vehicleForm.addEventListener("input", () => { validateVehicleRegion(); autoSave(); renderStatusTable(); });
    regionSelect.addEventListener("change", () => { updateTariff(); validateVehicleRegion(); autoSave(); renderStatusTable(); });

    // Maintenance
    const maintInputs = [currentKm, lastServiceDate, lastServiceKm, expiryBollo, expiryRevisione, expiryAssicurazione];
    maintInputs.forEach(el => {
      el.addEventListener("input", () => { validateMaintenance(); autoSave(); renderStatusTable(); });
      el.addEventListener("change", () => { validateMaintenance(); autoSave(); renderStatusTable(); });
    });

    // Thresholds
    thresholdDaysInput.addEventListener("change", () => {
      const val = Math.max(1, toInt(thresholdDaysInput.value) || 30);
      thresholdDaysInput.value = val;
      const s = loadSettings() || {};
      s.thresholdDays = val; saveSettings(s);
      renderStatusTable();
    });
    thresholdKmInput.addEventListener("change", () => {
      const val = Math.max(100, toInt(thresholdKmInput.value) || 1000);
      thresholdKmInput.value = val;
      const s = loadSettings() || {};
      s.thresholdKm = val; saveSettings(s);
      renderStatusTable();
    });
  };

  // ====== Init ======
  const init = async () => {
    // Carica tema e soglie
    const theme = loadTheme();
    if (theme) applyTheme(theme);

    const settings = loadSettings();
    if (settings) {
      if (Number.isFinite(settings.thresholdDays)) thresholdDaysInput.value = settings.thresholdDays;
      if (Number.isFinite(settings.thresholdKm)) thresholdKmInput.value = settings.thresholdKm;
    } else {
      saveSettings({ thresholdDays: toInt(thresholdDaysInput.value) || 30, thresholdKm: toInt(thresholdKmInput.value) || 1000 });
    }

    // Carica dati esterni con fallback (evita intoppi se i JSON non si trovano)
    vehicles = await safeFetchJson("assets/data/vehicles.json", EMBED_VEHICLES);
    regions  = await safeFetchJson("assets/data/regions.json", EMBED_REGIONS);

    populateVehicles(vehicles);
    populateRegions(regions);
    rebuildRegionMap();

    // Ripristina dati utente
    const saved = loadData();
    if (saved) applyData(saved);
    updateTariff();

    // Bind eventi
    bindThemeButtons();
    bindInputs();

    // Prima render
    validateVehicleRegion();
    validateMaintenance();
    renderStatusTable();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
