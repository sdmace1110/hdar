// ============================================================================
// D&D 5e Combat Tracker - Main Application Logic
// Based on app.md blueprint (Sections 6A, 16-18)
// ============================================================================

// ============================================================================
// CSS VARIABLE HELPERS
// ============================================================================

// Helper function to get CSS variable values
function getCSSVar(varName) {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(varName)
    .trim();
}

// Color palette from CSS variables (cached for performance)
const Colors = {
  white: null,
  whiteAlt: null,
  black: null,
  orange: null,
  cyan: null,
  green: null,
  gold: null,
  red: null,
  yellow: null,
  grayLight: null,
  grayMedium: null,
  grayDark: null,
  grayLighter: null,

  // Initialize cached color values
  init() {
    this.white = getCSSVar("--font-white");
    this.whiteAlt = getCSSVar("--font-white-alt");
    this.black = getCSSVar("--font-black");
    this.orange = getCSSVar("--font-orange");
    this.cyan = getCSSVar("--font-cyan");
    this.green = getCSSVar("--font-green");
    this.gold = getCSSVar("--font-gold");
    this.red = getCSSVar("--font-red");
    this.yellow = getCSSVar("--font-yellow");
    this.grayLight = getCSSVar("--font-gray-light");
    this.grayMedium = getCSSVar("--font-gray-medium");
    this.grayDark = getCSSVar("--font-gray-dark");
    this.grayLighter = getCSSVar("--font-gray-lighter");
  },

  // Helper for HP bar colors based on percentage
  getHPColor(hpPercent) {
    if (hpPercent <= 25) return this.red;
    if (hpPercent <= 50) return this.yellow;
    return this.green;
  },
};

// ============================================================================
// CONFIGURATION CONSTANTS
// ============================================================================

const CONFIG = {
  AUTO_SAVE_INTERVAL: 10000,
  MAX_EVENT_LOG_ENTRIES: 10,
  BLOB_REVOKE_DELAY: 200,
};

// ============================================================================
// DOM ELEMENT CACHE
// ============================================================================

const domCache = {
  eventLog: null,
  partyDashboard: null,
  enemyList: null,
  encounterName: null,
  currentRound: null,
  encounterDuration: null,
  encounterView: null,
  dashboardView: null,
  combatToolbar: null,
  partyOverview: null,
  recentEncounters: null,
  topDamage: null,
  topHealing: null,
  topKills: null,
  topHitRate: null,
  totalEncounters: null,
  totalRounds: null,
  totalDamage: null,
  totalDefeats: null,
  enemyName: null,
  enemyHP: null,
  enemyAC: null,

  init() {
    this.eventLog = document.getElementById("eventLog");
    this.partyDashboard = document.getElementById("partyDashboard");
    this.enemyList = document.getElementById("enemyList");
    this.encounterName = document.getElementById("encounterName");
    this.currentRound = document.getElementById("currentRound");
    this.encounterDuration = document.getElementById("encounterDuration");
    this.encounterView = document.getElementById("encounterView");
    this.dashboardView = document.getElementById("dashboardView");
    this.combatToolbar = document.querySelector(".combat-toolbar");
    this.partyOverview = document.getElementById("partyOverview");
    this.recentEncounters = document.getElementById("recentEncounters");
    this.topDamage = document.getElementById("topDamage");
    this.topHealing = document.getElementById("topHealing");
    this.topKills = document.getElementById("topKills");
    this.topHitRate = document.getElementById("topHitRate");
    this.totalEncounters = document.getElementById("totalEncounters");
    this.totalRounds = document.getElementById("totalRounds");
    this.totalDamage = document.getElementById("totalDamage");
    this.totalDefeats = document.getElementById("totalDefeats");
    this.enemyName = document.getElementById("enemyName");
    this.enemyHP = document.getElementById("enemyHP");
    this.enemyAC = document.getElementById("enemyAC");
  },
};

// ============================================================================
// UTILITY HELPERS
// ============================================================================

// Sanitize HTML to prevent XSS attacks
function escapeHTML(str) {
  if (typeof str !== "string") return str;
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// Parse positive integer with validation
function parsePositiveInt(value, defaultValue = 0) {
  const parsed = parseInt(value);
  return isNaN(parsed) || parsed < 0 ? defaultValue : parsed;
}

// Track event log rendering state
let lastRenderedEventCount = 0;

// ============================================================================
// CONSTANTS - EMPTY STATES
// ============================================================================

const EMPTY_STATES = {
  NO_EVENTS: "No events yet",
  NO_ENEMIES: "No enemies in combat",
  NO_PARTY: "No party members found",
  START_ENCOUNTER: "Start an encounter to see stats",
  NO_ENCOUNTER: "Start an encounter first",
  LOADING_PARTY: "Loading party data...",
  NO_ENCOUNTERS: "No encounters completed yet. Start your first encounter!",
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

// Check if encounter is active and show notification if not
function requireActiveEncounter() {
  if (!currentEncounter) {
    showNotification(EMPTY_STATES.NO_ENCOUNTER, "warning");
    return false;
  }
  return true;
}

// Show modal if encounter is active
function showModalIfEncounterActive(modalId) {
  if (!requireActiveEncounter()) return false;
  updatePartyDropdowns();
  showModal(modalId);
  return true;
}

// Get form value with optional parser
function getFormValue(id, parser = (v) => v) {
  const element = document.getElementById(id);
  return element ? parser(element.value) : parser("");
}

// Render empty state in container
function renderEmptyState(container, message) {
  if (!container) return;
  container.innerHTML = `<p class="empty-state">${message}</p>`;
}

// Apply attack damage to target (enemy or party member)
function applyAttackDamage(target, damage, attacker) {
  let actualDamage = damage;
  const enemy = getEnemy(target);

  if (enemy) {
    const wasAlive = enemy.hp > 0;
    actualDamage = Math.min(damage, enemy.hp);
    updateEnemyHP(target, enemy.hp - damage);

    if (wasAlive && enemy.hp === 0) {
      logEnemyDefeated(target, attacker);
    }
  } else {
    const result = damagePartyMember(target, damage);
    if (result) actualDamage = result.actualDamage;
  }

  return actualDamage;
}

// Populate dropdown with party members and optionally enemies
function populateDropdownOptions(dropdown, includeEnemies = true) {
  dropdown.innerHTML = '<option value="">Select...</option>';

  // Add party members
  if (campaignData?.party) {
    const partyGroup = document.createElement("optgroup");
    partyGroup.label = "Party Members";
    campaignData.party.forEach((member) => {
      const option = document.createElement("option");
      option.value = member.id;
      option.textContent = member.name;
      partyGroup.appendChild(option);
    });
    dropdown.appendChild(partyGroup);
  }

  // Add enemies if requested and available
  if (includeEnemies && currentEncounter?.enemies?.length > 0) {
    const enemyGroup = document.createElement("optgroup");
    enemyGroup.label = "Enemies";
    currentEncounter.enemies.forEach((enemy) => {
      if (enemy.hp > 0) {
        const option = document.createElement("option");
        option.value = enemy.id;
        option.textContent = `${enemy.name} (${enemy.hp}/${enemy.maxHp} HP)`;
        enemyGroup.appendChild(option);
      }
    });
    if (enemyGroup.children.length > 0) {
      dropdown.appendChild(enemyGroup);
    }
  }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

document.addEventListener("DOMContentLoaded", async () => {
  console.log("D&D Combat Tracker initializing...");

  // Initialize color cache and DOM cache
  Colors.init();
  domCache.init();

  // Load campaign data
  await loadCampaignData();

  // Initialize UI
  initializeUI();

  // Set up event listeners
  setupEventListeners();

  // Check for existing encounter in localStorage
  const savedEncounter = localStorage.getItem("current_encounter");
  if (savedEncounter) {
    try {
      currentEncounter = JSON.parse(savedEncounter);
      updateUI();
      showNotification("Resumed previous encounter", "info");
    } catch (e) {
      console.error("Failed to load saved encounter:", e);
    }
  } else {
    // No active encounter, show dashboard
    updateUI();
  }

  console.log("✅ Application ready!");
});

// ============================================================================
// UI INITIALIZATION
// ============================================================================

function initializeUI() {
  // Populate party dropdown in modals
  updatePartyDropdowns();

  // Update encounter info
  updateEncounterInfo();

  // Update party stats dashboard
  updatePartyDashboard();
}

function updatePartyDropdowns() {
  if (!campaignData) return;

  // Update all party/attacker/healer dropdowns
  document
    .querySelectorAll(".party-select, .attacker-select, .healer-select")
    .forEach((dropdown) => populateDropdownOptions(dropdown, true));

  // Update target dropdowns
  document
    .querySelectorAll(".target-select")
    .forEach((dropdown) => populateDropdownOptions(dropdown, true));
}

// ============================================================================
// EVENT LISTENERS
// ============================================================================

function setupEventListeners() {
  // Keyboard shortcuts
  document.addEventListener("keydown", handleKeyboardShortcuts);

  // Auto-save on encounter changes
  setInterval(() => {
    if (currentEncounter) {
      localStorage.setItem(
        "current_encounter",
        JSON.stringify(currentEncounter)
      );
    }
  }, CONFIG.AUTO_SAVE_INTERVAL);
}

function handleKeyboardShortcuts(e) {
  // Only when not in input field
  if (
    e.target.tagName === "INPUT" ||
    e.target.tagName === "TEXTAREA" ||
    e.target.tagName === "SELECT"
  ) {
    return;
  }

  switch (e.key.toLowerCase()) {
    case "a":
      showQuickAttack();
      break;
    case "h":
      showQuickHeal();
      break;
    case "s":
      showQuickSpell();
      break;
    case "k":
      showQuickSkillCheck();
      break;
    case "r":
      if (currentEncounter && confirm("Start new round?")) {
        handleNewRound();
      }
      break;
    case "n":
      showQuickNote();
      break;
    case "escape":
      closeAllModals();
      break;
  }
}

// ============================================================================
// ENCOUNTER MANAGEMENT UI
// ============================================================================

function handleStartEncounter() {
  const name = prompt("Enter encounter name:");
  if (!name) return;

  if (!campaignData || !campaignData.party || campaignData.party.length === 0) {
    showNotification(
      "No party members found. Load campaign data first.",
      "error"
    );
    return;
  }

  startNewEncounter(name, [...campaignData.party]);
  updateUI();
  showNotification(`Encounter "${name}" started!`, "success");
}

function handleNewRound() {
  if (!currentEncounter) {
    showNotification("No active encounter", "warning");
    return;
  }

  startNewRound();
  updateUI();
  showNotification(`Round ${currentEncounter.currentRound} started`, "info");
  playSound("round");
}

function handleEndEncounter() {
  if (!currentEncounter) return;

  if (!confirm("End this encounter and save results?")) return;

  const summary = finalizeEncounter();

  if (summary) {
    showEncounterSummary(summary);
    updateUI();
    localStorage.removeItem("current_encounter");
    showNotification("Encounter finalized and saved!", "success");
  }
}

// ============================================================================
// QUICK ACTION MODALS
// ============================================================================

function showQuickAttack() {
  showModalIfEncounterActive("quickAttackModal");
}

function submitQuickAttack(event) {
  event.preventDefault();

  const attacker = getFormValue("attackAttacker");
  const target = getFormValue("attackTarget");
  const attackRoll = getFormValue("attackRoll", parsePositiveInt);
  const damage = getFormValue("attackDamage", parsePositiveInt);
  const result = event.submitter.dataset.result;

  if (!attacker || !target) {
    showNotification("Select attacker and target", "warning");
    return;
  }

  const actualDamage = applyAttackDamage(target, damage, attacker);

  if (result === "hit") {
    logAttackHit(attacker, target, actualDamage, { attackRoll });
  } else if (result === "crit") {
    logCriticalHit(attacker, target, actualDamage, { attackRoll });
  } else if (result === "miss") {
    logAttackMiss(attacker, target, attackRoll);
  }

  if (actualDamage > 0 && result !== "miss") {
    logDamageTaken(target, actualDamage, "slashing", attacker);
  }

  closeModal("quickAttackModal");
  event.target.reset();
  updateUI();
  playSound(result);

  showNotification(
    `${result.toUpperCase()}: ${damage} damage`,
    result === "crit" ? "success" : "info"
  );
}

function showQuickHeal() {
  showModalIfEncounterActive("quickHealModal");
}

function submitQuickHeal(event) {
  event.preventDefault();

  const healer = getFormValue("healHealer");
  const target = getFormValue("healTarget");
  const healing = getFormValue("healAmount", parsePositiveInt);
  const source = getFormValue("healSource") || "healing";

  if (!healer || !target || !healing) {
    showNotification("Fill all fields", "warning");
    return;
  }

  // Apply healing to target (enemy or party member)
  let actualHealing = healing;
  const enemy = getEnemy(target);
  if (enemy) {
    const oldHP = enemy.hp;
    updateEnemyHP(target, enemy.hp + healing);
    actualHealing = enemy.hp - oldHP;
  } else {
    const result = healPartyMember(target, healing);
    if (result) actualHealing = result.actualHealing;
  }

  logHealing(healer, target, actualHealing, source);

  closeModal("quickHealModal");
  event.target.reset();
  updateUI();
  playSound("heal");

  showNotification(`${actualHealing} HP healed!`, "success");
}

function showQuickSpell() {
  showModalIfEncounterActive("quickSpellModal");
}

function submitQuickSpell(event) {
  event.preventDefault();

  const caster = getFormValue("spellCaster");
  const spellName = getFormValue("spellName");
  const spellLevel = getFormValue("spellLevel", parsePositiveInt);
  const target = getFormValue("spellTarget");
  const damage = getFormValue("spellDamage", parsePositiveInt);

  if (!caster || !spellName) {
    showNotification("Enter caster and spell name", "warning");
    return;
  }

  let actualDamage = damage;
  if (target && damage) {
    actualDamage = applyAttackDamage(target, damage, caster);
    if (actualDamage > 0) {
      logDamageTaken(target, actualDamage, "magical", caster);
    }
  }

  const targets = target ? [target] : [];
  const results =
    target && actualDamage ? [{ target, damageTaken: actualDamage }] : [];

  logSpellCast(caster, spellName, spellLevel, targets, results);

  closeModal("quickSpellModal");
  event.target.reset();
  updateUI();
  playSound("spell");

  showNotification(`${spellName} cast!`, "info");
}

function showQuickSkillCheck() {
  showModalIfEncounterActive("quickSkillModal");
}

function submitQuickSkillCheck(event) {
  event.preventDefault();

  const actor = getFormValue("skillActor");
  const skill = getFormValue("skillName");
  const roll = getFormValue("skillRoll", parsePositiveInt);
  const dc = getFormValue("skillDC", parsePositiveInt);
  const success = roll >= dc;

  if (!actor || !skill) {
    showNotification("Select actor and skill", "warning");
    return;
  }

  logSkillCheck(actor, skill, roll, dc, success);

  closeModal("quickSkillModal");
  event.target.reset();
  updateUI();

  showNotification(
    `${skill}: ${roll} vs DC ${dc} - ${success ? "SUCCESS" : "FAIL"}`,
    success ? "success" : "warning"
  );
}

function showQuickNote() {
  const text = prompt("Enter note:");
  if (text) {
    logNote(text);
    updateUI();
    showNotification("Note added", "info");
  }
}

// ============================================================================
// ENEMY MANAGEMENT
// ============================================================================

function showAddEnemy() {
  showModal("addEnemyModal");
}

function submitAddEnemy(event) {
  event.preventDefault();

  const name = domCache.enemyName.value;
  const hp = parsePositiveInt(domCache.enemyHP.value, 1);
  const ac = parsePositiveInt(domCache.enemyAC.value, 10);

  if (!name) {
    showNotification("Enter enemy name", "warning");
    return;
  }

  addEnemy(name, hp, ac);

  closeModal("addEnemyModal");
  event.target.reset();
  updateUI();

  showNotification(`${name} added to battle`, "info");
}

function handleDamageEnemy(enemyId) {
  const damage = parsePositiveInt(prompt("Damage amount:"));
  if (damage <= 0) return;

  const enemy = getEnemy(enemyId);
  if (!enemy) return;

  updateEnemyHP(enemyId, enemy.hp - damage);
  updateUI();

  if (enemy.hp === 0) {
    showNotification(`${enemy.name} defeated!`, "success");
    playSound("defeated");
  }
}

function handleRemoveEnemy(enemyId) {
  const enemy = getEnemy(enemyId);
  if (!enemy) return;

  if (confirm(`Remove ${enemy.name} from battle?`)) {
    if (enemy.hp === 0) {
      const killer = prompt("Who got the killing blow?") || "party";
      logEnemyDefeated(enemyId, killer);
    }
    removeEnemy(enemyId);
    updateUI();
  }
}

// ============================================================================
// UI UPDATES
// ============================================================================

function updateUI() {
  // Toggle between encounter view and dashboard view
  if (currentEncounter) {
    // Show encounter view
    domCache.encounterView.style.display = "grid";
    domCache.dashboardView.style.display = "none";

    // Enable combat toolbar
    if (domCache.combatToolbar) {
      domCache.combatToolbar.classList.remove("disabled");
    }

    updateEncounterInfo();
    updateEnemyTracker();
    updateEventLog();
    updatePartyDashboard();
  } else {
    // Show dashboard view
    domCache.encounterView.style.display = "none";
    domCache.dashboardView.style.display = "block";

    // Disable combat toolbar
    if (domCache.combatToolbar) {
      domCache.combatToolbar.classList.add("disabled");
    }

    updateDashboardView();
  }
}

function updateEncounterInfo() {
  if (
    !domCache.encounterName ||
    !domCache.currentRound ||
    !domCache.encounterDuration
  )
    return;

  if (currentEncounter) {
    domCache.encounterName.textContent = escapeHTML(currentEncounter.name);
    domCache.currentRound.textContent = currentEncounter.currentRound;

    const duration = Math.floor(
      (Date.now() - currentEncounter.startTime) / 1000
    );
    const minutes = Math.floor(duration / 60);
    const seconds = duration % 60;
    domCache.encounterDuration.textContent = `${minutes}:${seconds
      .toString()
      .padStart(2, "0")}`;
  } else {
    domCache.encounterName.textContent = "No Active Encounter";
    domCache.currentRound.textContent = "0";
    domCache.encounterDuration.textContent = "0:00";
  }
}

function updateEnemyTracker() {
  if (!domCache.enemyList) return;

  if (!currentEncounter || currentEncounter.enemies.length === 0) {
    renderEmptyState(domCache.enemyList, EMPTY_STATES.NO_ENEMIES);
    return;
  }

  domCache.enemyList.innerHTML = "";

  currentEncounter.enemies.forEach((enemy) => {
    const card = createEnemyCard(enemy);
    domCache.enemyList.appendChild(card);
  });
}

function createEnemyCard(enemy) {
  const card = document.createElement("div");
  card.className = `enemy-card ${enemy.hp === 0 ? "defeated" : ""}`;
  card.dataset.enemyId = enemy.id;

  const hpPercent = (enemy.hp / enemy.maxHp) * 100;
  const hpColor = Colors.getHPColor(hpPercent);

  card.innerHTML = `
    <div class="enemy-header">
      <span class="enemy-name">${escapeHTML(enemy.name)}</span>
      <span class="enemy-ac">AC ${enemy.ac}</span>
    </div>
    <div class="enemy-hp">
      <span class="hp-text">${enemy.hp} / ${enemy.maxHp}</span>
      <div class="hp-bar">
        <div class="hp-fill" style="width: ${hpPercent}%; background-color: ${hpColor};"></div>
      </div>
    </div>
    <div class="enemy-actions">
      <button onclick="handleDamageEnemy('${
        enemy.id
      }')" class="btn-small btn-damage">⚔️ Dmg</button>
      <button onclick="handleRemoveEnemy('${
        enemy.id
      }')" class="btn-small btn-danger">💀</button>
    </div>
  `;

  return card;
}

function updateEventLog() {
  if (!domCache.eventLog) return;

  if (!currentEncounter || currentEncounter.events.length === 0) {
    renderEmptyState(domCache.eventLog, EMPTY_STATES.NO_EVENTS);
    lastRenderedEventCount = 0;
    return;
  }

  // Show last N events
  const recentEvents = currentEncounter.events
    .slice(-CONFIG.MAX_EVENT_LOG_ENTRIES)
    .reverse();

  domCache.eventLog.innerHTML = "";
  recentEvents.forEach((event) => {
    const entry = createEventLogEntry(event);
    domCache.eventLog.appendChild(entry);
  });

  lastRenderedEventCount = currentEncounter.events.length;
}

// Event log formatter map
const EVENT_FORMATTERS = {
  attack_hit: (event, getName) => ({
    icon: "⚔️",
    message: `${getName(event.actor)} hit ${getName(event.target)} for ${
      event.data.damageTotal
    } damage`,
    className: "",
  }),
  attack_crit: (event, getName) => ({
    icon: "💥",
    message: `${getName(event.actor)} CRIT ${getName(event.target)} for ${
      event.data.damageTotal
    } damage!`,
    className: "crit",
  }),
  attack_miss: (event, getName) => ({
    icon: "❌",
    message: `${getName(event.actor)} missed ${getName(event.target)}`,
    className: "",
  }),
  healing_done: (event, getName) => ({
    icon: "❤️",
    message: `${getName(event.actor)} healed ${getName(event.target)} for ${
      event.data.healingTotal
    } HP`,
    className: "",
  }),
  spell_cast: (event, getName) => ({
    icon: "✨",
    message: `${getName(event.actor)} cast ${event.data.spellName}`,
    className: "",
  }),
  enemy_defeated: (event, getName) => ({
    icon: "💀",
    message: `${event.data.enemyName} defeated by ${getName(event.actor)}!`,
    className: "defeat",
  }),
  round_start: (event, getName) => ({
    icon: "🔄",
    message: `Round ${event.data.roundNumber} started`,
    className: "round-marker",
  }),
  note: (event, getName) => ({
    icon: "📝",
    message: event.data.text,
    className: "",
  }),
};

function createEventLogEntry(event) {
  const entry = document.createElement("div");
  entry.className = "event-entry";

  // Helper function to get display name (party member or enemy)
  const getDisplayName = (id) => {
    if (!id) return "Unknown";
    const partyMember = campaignData?.party?.find((p) => p.id === id);
    if (partyMember) return partyMember.name;
    const enemy = getEnemy(id);
    return enemy ? enemy.name : id;
  };

  const formatter = EVENT_FORMATTERS[event.type];
  const {
    icon = "📝",
    message = `${event.type}: ${getDisplayName(event.actor)}`,
    className = "",
  } = formatter ? formatter(event, getDisplayName) : {};

  if (className) entry.classList.add(className);

  entry.innerHTML = `
    <span class="event-icon">${icon}</span>
    <span class="event-message">${message}</span>
    <span class="event-time">[R${event.round}]</span>
  `;

  return entry;
}

function updatePartyDashboard() {
  if (!domCache.partyDashboard) return;

  if (!currentEncounter) {
    renderEmptyState(domCache.partyDashboard, EMPTY_STATES.START_ENCOUNTER);
    return;
  }

  domCache.partyDashboard.innerHTML = "";

  currentEncounter.party.forEach((member) => {
    const stats = getPlayerStats(member.id);
    const card = createPartyStatsCard(member, stats);
    domCache.partyDashboard.appendChild(card);
  });
}

function createPartyStatsCard(member, stats) {
  const card = document.createElement("div");
  card.className = "party-stat-card";
  card.style.borderLeftColor = member.color;

  // Calculate HP percentage for color coding
  const hpPercent = (member.currentHp / member.maxHp) * 100;
  const hpColor = Colors.getHPColor(hpPercent);

  card.innerHTML = `
    <div class="party-card-header" style="color: ${member.color};">
      <h3>${escapeHTML(member.name)}</h3>
      <span class="party-class">${escapeHTML(member.class)}</span>
    </div>
    <div class="party-hp-display">
      <span class="party-hp-text">${member.currentHp} / ${
    member.maxHp
  } HP</span>
      <div class="party-hp-bar">
        <div class="party-hp-fill" style="width: ${hpPercent}%; background-color: ${hpColor};"></div>
      </div>
    </div>
    <div class="party-stats">
      <div class="stat-row">
        <span class="stat-label">AC:</span>
        <span class="stat-value">${member.ac}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Damage Dealt:</span>
        <span class="stat-value">${stats.totalDamageDealt}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Damage Taken:</span>
        <span class="stat-value">${stats.totalDamageTaken}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Healing Done:</span>
        <span class="stat-value">${stats.totalHealingDone}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Healing Received:</span>
        <span class="stat-value">${stats.totalHealingReceived}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Hit Rate:</span>
        <span class="stat-value">${stats.hitRate}%</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">DPS:</span>
        <span class="stat-value">${stats.dps}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Kills:</span>
        <span class="stat-value">${stats.enemiesDefeated}</span>
      </div>
    </div>
  `;

  return card;
}

// ============================================================================
// DASHBOARD VIEW UPDATES
// ============================================================================

function updateDashboardView() {
  if (!campaignData) return;

  // Update campaign stats
  updateCampaignStats();

  // Update party overview
  updatePartyOverview();

  // Update recent encounters
  updateRecentEncounters();

  // Update top performers
  updateTopPerformers();

  // Update stats trends chart
  updateStatsTrendsChart();
  updateHealingTrendsChart();
}

function updateCampaignStats() {
  const encounters = campaignData?.encounters || [];

  const totalEncounters = encounters.length;
  const totalRounds = encounters.reduce(
    (sum, enc) => sum + (enc.currentRound || 0),
    0
  );
  const totalDamage = encounters.reduce(
    (sum, enc) => sum + (enc.summary?.totalDamageDealt || 0),
    0
  );
  const totalDefeats = encounters.reduce(
    (sum, enc) => sum + (enc.summary?.enemiesDefeated || 0),
    0
  );

  domCache.totalEncounters.textContent = totalEncounters;
  domCache.totalRounds.textContent = totalRounds;
  domCache.totalDamage.textContent = totalDamage;
  domCache.totalDefeats.textContent = totalDefeats;
}

function updatePartyOverview() {
  const container = domCache.partyOverview;
  if (!container) return;

  if (!campaignData?.party?.length) {
    renderEmptyState(container, EMPTY_STATES.NO_PARTY);
    return;
  }

  container.innerHTML = campaignData.party
    .map(
      (member) => `
    <div class="party-overview-item">
      <div class="party-overview-icon" style="background-color: ${
        member.color
      };">
        ${escapeHTML(member.name.charAt(0))}
      </div>
      <div class="party-overview-info">
        <div class="party-overview-name">${escapeHTML(member.name)}</div>
        <div class="party-overview-class">${escapeHTML(member.class)} - Level ${
        member.level
      }</div>
      </div>
    </div>
  `
    )
    .join("");
}

function updateRecentEncounters() {
  const container = domCache.recentEncounters;
  if (!container) return;

  const encounters = campaignData?.encounters || [];
  if (encounters.length === 0) {
    container.innerHTML =
      '<p class="empty-state">No encounters completed yet. Start your first encounter!</p>';
    return;
  }

  // Show last 5 encounters
  const recentEncounters = encounters.slice(-5).reverse();

  container.innerHTML = recentEncounters
    .map((enc) => {
      const duration =
        enc.endTime && enc.startTime
          ? Math.floor((enc.endTime - enc.startTime) / 1000 / 60)
          : 0;
      const date = new Date(enc.startTime).toLocaleDateString();

      return `
      <div class="encounter-summary-card">
        <div class="encounter-summary-header">
          <h4>${enc.name}</h4>
          <span class="encounter-date">${date}</span>
        </div>
        <div class="encounter-summary-stats">
          <div class="encounter-stat">
            <span class="encounter-stat-label">Rounds:</span>
            <span class="encounter-stat-value">${enc.currentRound || 0}</span>
          </div>
          <div class="encounter-stat">
            <span class="encounter-stat-label">Duration:</span>
            <span class="encounter-stat-value">${duration}m</span>
          </div>
          <div class="encounter-stat">
            <span class="encounter-stat-label">MVP:</span>
            <span class="encounter-stat-value">${
              enc.summary?.mvp || "--"
            }</span>
          </div>
          <div class="encounter-stat">
            <span class="encounter-stat-label">Damage:</span>
            <span class="encounter-stat-value">${
              enc.summary?.totalDamageDealt || 0
            }</span>
          </div>
        </div>
      </div>
    `;
    })
    .join("");
}

function updateTopPerformers() {
  const encounters = campaignData?.encounters || [];

  if (encounters.length === 0) {
    domCache.topDamage.textContent = "--";
    domCache.topHealing.textContent = "--";
    domCache.topKills.textContent = "--";
    domCache.topHitRate.textContent = "--";
    return;
  }

  // Aggregate stats across all encounters
  const playerStats = {};

  encounters.forEach((enc) => {
    if (!enc.finalStats) return;

    Object.entries(enc.finalStats).forEach(([playerId, stats]) => {
      if (!playerStats[playerId]) {
        // Get player name from campaign data
        const member = campaignData.party.find((p) => p.id === playerId);
        playerStats[playerId] = {
          name: member ? member.name : playerId,
          totalDamage: 0,
          totalHealing: 0,
          totalKills: 0,
          totalAttacks: 0,
          attacksHit: 0,
        };
      }

      playerStats[playerId].totalDamage += stats.totalDamageDealt || 0;
      playerStats[playerId].totalHealing += stats.totalHealingDone || 0;
      playerStats[playerId].totalKills += stats.enemiesDefeated || 0;
      playerStats[playerId].totalAttacks += stats.totalAttacks || 0;
      playerStats[playerId].attacksHit += stats.attacksHit || 0;
    });
  });

  const players = Object.values(playerStats);

  // Check if we have any players with stats
  if (players.length === 0) {
    domCache.topDamage.textContent = "--";
    domCache.topHealing.textContent = "--";
    domCache.topKills.textContent = "--";
    domCache.topHitRate.textContent = "--";
    return;
  }

  // Find top performers
  const topDamage = players.reduce(
    (max, p) => (p.totalDamage > max.totalDamage ? p : max),
    players[0]
  );
  const topHealing = players.reduce(
    (max, p) => (p.totalHealing > max.totalHealing ? p : max),
    players[0]
  );
  const topKills = players.reduce(
    (max, p) => (p.totalKills > max.totalKills ? p : max),
    players[0]
  );

  // Calculate hit rates
  const playersWithHitRate = players.map((p) => ({
    ...p,
    hitRate:
      p.totalAttacks > 0
        ? ((p.attacksHit / p.totalAttacks) * 100).toFixed(1)
        : 0,
  }));
  const topHitRate = playersWithHitRate.reduce(
    (max, p) => (parseFloat(p.hitRate) > parseFloat(max.hitRate) ? p : max),
    playersWithHitRate[0]
  );

  domCache.topDamage.textContent = topDamage.name
    ? `${topDamage.name} (${topDamage.totalDamage})`
    : "--";
  domCache.topHealing.textContent = topHealing.name
    ? `${topHealing.name} (${topHealing.totalHealing})`
    : "--";
  domCache.topKills.textContent = topKills.name
    ? `${topKills.name} (${topKills.totalKills})`
    : "--";
  domCache.topHitRate.textContent = topHitRate.name
    ? `${topHitRate.name} (${topHitRate.hitRate}%)`
    : "--";
}

function loadPastEncounter() {
  showNotification("Past encounter viewer coming soon!", "info");
}

// ============================================================================
// STATS TRENDS CHART (Chart.js)
// ============================================================================

let statsTrendsChart = null;
let currentMetric = "avgDamage";

let healingTrendsChart = null;
let currentHealingMetric = "avgHealing";
let cachedMockEncounters = null;

function updateStatsTrendsChart() {
  if (!campaignData || !campaignData.encounters) return;

  let encounters = campaignData.encounters;

  // Add initial encounter 0 with all stats at 0 for aesthetic effect
  const zeroEncounter = {
    id: "encounter_0",
    name: "Start",
    stats: {},
  };

  // Initialize zero stats for each party member
  if (campaignData.party) {
    campaignData.party.forEach((member) => {
      zeroEncounter.stats[member.id] = {
        damage: 0,
        healing: 0,
        attacks: 0,
        hits: 0,
        hitRate: 0,
        dps: 0,
        hps: 0,
      };
    });
  }

  // Prepend zero encounter to the beginning
  encounters = [zeroEncounter, ...encounters];

  // Build datasets for each party member
  const datasets = buildChartDatasets(encounters, currentMetric);

  // Initialize or update chart
  const ctx = document.getElementById("statsTrendsChart");
  if (!ctx) return;

  if (statsTrendsChart) {
    // Update existing chart
    statsTrendsChart.data.labels = encounters.map((enc, idx) =>
      idx === 0 ? "0" : `#${idx}`
    );
    statsTrendsChart.data.datasets = datasets;
    statsTrendsChart.options.plugins.title.text = getChartTitle(currentMetric);
    statsTrendsChart.update();
  } else {
    // Create new chart
    statsTrendsChart = new Chart(ctx, {
      type: "line",
      data: {
        labels: encounters.map((enc, idx) => (idx === 0 ? "0" : `#${idx}`)),
        datasets: datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          title: {
            display: true,
            text: getChartTitle(currentMetric),
            color: Colors.cyan,
            font: {
              size: 14,
              weight: "bold",
            },
          },
          legend: {
            display: true,
            position: "top",
            labels: {
              color: Colors.whiteAlt,
              font: {
                size: 11,
              },
              usePointStyle: true,
            },
          },
          tooltip: {
            mode: "index",
            intersect: false,
            backgroundColor: "rgba(0, 0, 0, 0.8)",
            titleColor: Colors.cyan,
            bodyColor: Colors.whiteAlt,
            borderColor: Colors.orange,
            borderWidth: 1,
          },
        },
        scales: {
          x: {
            title: {
              display: true,
              text: "Encounter #",
              color: Colors.grayLight,
              font: {
                size: 12,
              },
            },
            ticks: {
              color: Colors.grayLight,
            },
            grid: {
              color: "rgba(255, 255, 255, 0.1)",
            },
          },
          y: {
            title: {
              display: true,
              text: getYAxisLabel(currentMetric),
              color: Colors.grayLight,
              font: {
                size: 12,
              },
            },
            ticks: {
              color: Colors.grayLight,
            },
            grid: {
              color: "rgba(255, 255, 255, 0.1)",
            },
            beginAtZero: true,
          },
        },
        interaction: {
          mode: "nearest",
          axis: "x",
          intersect: false,
        },
      },
    });
  }
}

function buildChartDatasets(encounters, metric) {
  console.log(
    "buildChartDatasets called with metric:",
    metric,
    "encounters:",
    encounters.length
  );

  // Get all unique party member IDs
  const partyMembers = new Map();

  encounters.forEach((enc) => {
    if (!enc.finalStats) {
      console.log("Encounter missing finalStats:", enc.name);
      return;
    }

    Object.entries(enc.finalStats).forEach(([playerId, stats]) => {
      if (!partyMembers.has(playerId)) {
        // Find party member details
        const member = campaignData.party.find((p) => p.id === playerId);
        partyMembers.set(playerId, {
          id: playerId,
          name: member ? member.name : playerId,
          color: member ? member.color : getRandomColor(),
          data: [],
        });
      }
    });
  });

  console.log("Party members found:", partyMembers.size);

  // Metric extractors map for cleaner code
  const METRIC_EXTRACTORS = {
    avgDamage: (stats) => parseFloat(stats.averageDamagePerHit) || 0,
    avgHealing: (stats) => {
      if (stats.averageHealingPerCast !== undefined) {
        return parseFloat(stats.averageHealingPerCast) || 0;
      }
      return stats.totalHealingDone && stats.spellsCast
        ? stats.totalHealingDone / stats.spellsCast
        : stats.totalHealingDone || 0;
    },
    dps: (stats) => parseFloat(stats.dps) || 0,
    hps: (stats) => {
      if (stats.hps !== undefined) return parseFloat(stats.hps) || 0;
      return stats.totalHealingDone && stats.roundsActive
        ? stats.totalHealingDone / stats.roundsActive
        : stats.totalHealingDone || 0;
    },
    skillChecks: (stats) => stats.skillChecks?.successes || 0,
  };

  // Build data points for each party member
  encounters.forEach((enc, encIdx) => {
    partyMembers.forEach((member, playerId) => {
      const stats = enc.finalStats?.[playerId];
      const value = stats ? METRIC_EXTRACTORS[metric]?.(stats) || 0 : 0;
      member.data.push(value);
    });
  });

  // Convert to Chart.js datasets
  const datasets = Array.from(partyMembers.values()).map((member) => ({
    label: member.name,
    data: member.data,
    borderColor: member.color,
    backgroundColor: member.color + "33", // Add transparency
    borderWidth: 2,
    pointRadius: 4,
    pointHoverRadius: 6,
    tension: 0.3, // Smooth lines
  }));

  return datasets;
}

function getChartTitle(metric) {
  switch (metric) {
    case "avgDamage":
      return "Average Damage Per Hit";
    case "avgHealing":
      return "Average Healing Per Cast";
    case "dps":
      return "Damage Per Second (DPS)";
    case "hps":
      return "Healing Per Second (HPS)";
    case "skillChecks":
      return "Skill Check Successes";
    default:
      return "Stats Trends";
  }
}

function getYAxisLabel(metric) {
  switch (metric) {
    case "avgDamage":
      return "Damage";
    case "avgHealing":
      return "Healing";
    case "dps":
      return "DPS";
    case "hps":
      return "HPS";
    case "skillChecks":
      return "Successes";
    default:
      return "Value";
  }
}

function getRandomColor() {
  const colors = [
    Colors.orange,
    Colors.cyan,
    Colors.green,
    Colors.yellow,
    Colors.red,
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

function generateMockEncounters() {
  if (!campaignData || !campaignData.party) return [];

  // Return cached mock encounters if already generated
  if (cachedMockEncounters) {
    return cachedMockEncounters;
  }

  const mockEncounters = [];
  const partyIds = campaignData.party.map((p) => p.id);

  // Generate 5 mock encounters
  for (let i = 0; i < 5; i++) {
    const encounter = {
      name: `Mock Encounter ${i + 1}`,
      finalStats: {},
    };

    // Generate stats for each party member
    partyIds.forEach((playerId) => {
      encounter.finalStats[playerId] = {
        totalDamageDealt: Math.floor(Math.random() * 50) + 20,
        totalHealingDone: Math.floor(Math.random() * 30) + 5,
        enemiesDefeated: Math.floor(Math.random() * 3) + 1,
        totalAttacks: Math.floor(Math.random() * 10) + 5,
        attacksHit: Math.floor(Math.random() * 7) + 3,
        averageDamagePerHit: (Math.random() * 10 + 5).toFixed(1),
        averageHealingPerCast: (Math.random() * 8 + 3).toFixed(1),
        dps: (Math.random() * 5 + 2).toFixed(2),
        hps: (Math.random() * 3 + 1).toFixed(2),
        skillChecks: {
          successes: Math.floor(Math.random() * 5) + 2,
          attempts: Math.floor(Math.random() * 8) + 3,
        },
      };
    });

    mockEncounters.push(encounter);
  }

  // Cache the mock encounters
  cachedMockEncounters = mockEncounters;

  return mockEncounters;
}

// ============================================================================
// HEALING TRENDS CHART
// ============================================================================

function updateHealingTrendsChart() {
  if (!campaignData || !campaignData.encounters) {
    return;
  }

  let encounters = campaignData.encounters;

  // Add initial encounter 0 with all stats at 0 for aesthetic effect
  const zeroEncounter = {
    id: "encounter_0",
    name: "Start",
    stats: {},
  };

  // Initialize zero stats for each party member
  if (campaignData.party) {
    campaignData.party.forEach((member) => {
      zeroEncounter.stats[member.id] = {
        damage: 0,
        healing: 0,
        attacks: 0,
        hits: 0,
        hitRate: 0,
        dps: 0,
        hps: 0,
      };
    });
  }

  // Prepend zero encounter to the beginning
  encounters = [zeroEncounter, ...encounters];

  // Build datasets for each party member
  const datasets = buildChartDatasets(encounters, currentHealingMetric);

  // Initialize or update chart
  const ctx = document.getElementById("healingTrendsChart");
  if (!ctx) return;

  if (healingTrendsChart) {
    // Update existing chart
    healingTrendsChart.data.labels = encounters.map((enc, idx) =>
      idx === 0 ? "0" : `#${idx}`
    );
    healingTrendsChart.data.datasets = datasets;
    healingTrendsChart.options.plugins.title.text =
      getChartTitle(currentHealingMetric);
    healingTrendsChart.update();
  } else {
    // Create new chart
    healingTrendsChart = new Chart(ctx, {
      type: "line",
      data: {
        labels: encounters.map((enc, idx) => (idx === 0 ? "0" : `#${idx}`)),
        datasets: datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          title: {
            display: true,
            text: getChartTitle(currentHealingMetric),
            color: Colors.green,
            font: {
              size: 14,
              weight: "bold",
            },
          },
          legend: {
            display: true,
            position: "top",
            labels: {
              color: Colors.whiteAlt,
              font: {
                size: 11,
              },
              usePointStyle: true,
            },
          },
        },
        scales: {
          x: {
            title: {
              display: true,
              text: "Encounter #",
              color: Colors.green,
            },
            ticks: {
              color: Colors.grayLighter,
            },
            grid: {
              color: "rgba(255, 255, 255, 0.1)",
            },
          },
          y: {
            beginAtZero: true,
            title: {
              display: true,
              text: getYAxisLabel(currentHealingMetric),
              color: Colors.green,
            },
            ticks: {
              color: Colors.grayLighter,
            },
            grid: {
              color: "rgba(255, 255, 255, 0.1)",
            },
          },
        },
      },
    });
  }
}

// Setup metric toggle buttons
document.addEventListener("DOMContentLoaded", () => {
  const toggleButtons = document.querySelectorAll(
    "#damageTrendsCard .metric-toggle-btn"
  );

  toggleButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      // Remove active class from all damage buttons
      toggleButtons.forEach((b) => b.classList.remove("active"));

      // Add active class to clicked button
      btn.classList.add("active");

      // Update current metric and refresh chart
      currentMetric = btn.dataset.metric;
      updateStatsTrendsChart();
    });
  });
});

// Healing Trends Chart Toggle Listeners
document.addEventListener("DOMContentLoaded", () => {
  const healingToggleButtons = document.querySelectorAll(
    "#healingTrendsCard .metric-toggle-btn"
  );

  healingToggleButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      // Remove active class from all buttons
      healingToggleButtons.forEach((b) => b.classList.remove("active"));

      // Add active class to clicked button
      btn.classList.add("active");

      // Update current healing metric and refresh chart
      currentHealingMetric = btn.dataset.metric;
      updateHealingTrendsChart();
    });
  });
});

// ============================================================================
// MODAL MANAGEMENT
// ============================================================================

function showModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add("active");
    activeModal = modalId;

    // Focus first input
    const firstInput = modal.querySelector("input, select");
    if (firstInput) firstInput.focus();
  }
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove("active");
    activeModal = null;
  }
}

function closeAllModals() {
  const modals = document.querySelectorAll(".modal");
  modals.forEach((modal) => modal.classList.remove("active"));
  activeModal = null;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function showNotification(message, type = "info") {
  const notification = document.createElement("div");
  notification.className = `notification notification-${type}`;
  notification.textContent = message;

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.classList.add("show");
  }, 10);

  setTimeout(() => {
    notification.classList.remove("show");
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

function playSound(type) {
  // Placeholder for sound effects
  // Can add audio elements and play them based on type
  console.log(`🔊 Sound: ${type}`);
}

function rollD20(inputId) {
  const roll = Math.floor(Math.random() * 20) + 1;
  const input = document.getElementById(inputId);
  if (input) {
    input.value = roll;

    if (roll === 20) {
      showNotification("Natural 20! 🎉", "success");
      playSound("crit");
    } else if (roll === 1) {
      showNotification("Natural 1... 😬", "warning");
    }
  }
  return roll;
}

function rollDice(diceString) {
  // Parse dice string like "2d6+3"
  const match = diceString.match(/(\d+)d(\d+)(?:\+(\d+))?/);
  if (!match) return 0;

  const [, numDice, diceSides, modifier] = match;
  let total = parseInt(modifier) || 0;

  for (let i = 0; i < parseInt(numDice); i++) {
    total += Math.floor(Math.random() * parseInt(diceSides)) + 1;
  }

  return total;
}

function showEncounterSummary(encounter) {
  const summary = encounter.summary;
  const mvp = encounter.finalStats[getTopPerformer("totalDamageDealt").id];

  alert(`
    ═══════════════════════════════════
    ENCOUNTER COMPLETE: ${encounter.name}
    ═══════════════════════════════════
    
    Duration: ${Math.floor(summary.duration / 60000)}m ${Math.floor(
    (summary.duration % 60000) / 1000
  )}s
    Rounds: ${summary.totalRounds}
    Total Damage: ${summary.totalDamageDealt}
    Total Healing: ${summary.totalHealingDone}
    Enemies Defeated: ${summary.enemiesDefeated}
    
    MVP: ${summary.mvp}
    
    ═══════════════════════════════════
  `);
}

// ============================================================================
// EVENT EMISSION (for real-time updates)
// ============================================================================

function emitEventUpdate(event) {
  // Update UI in real-time when event is logged
  updateUI();

  // Could also emit to WebSocket or other real-time system
  console.log("Event logged:", event.type, event);
}

// ============================================================================
// DICE ROLLING TOOLS
// ============================================================================

function showDiceRoller() {
  const result = prompt("Enter dice (e.g., 2d6+3):");
  if (result) {
    const roll = rollDice(result);
    showNotification(`Rolled ${result}: ${roll}`, "info");
  }
}

// ============================================================================
// EXPORT FUNCTIONS
// ============================================================================

function handleExportCampaign() {
  exportCampaignData();
  showNotification("Campaign exported!", "success");
}

// Make functions globally accessible
window.handleStartEncounter = handleStartEncounter;
window.handleNewRound = handleNewRound;
window.handleEndEncounter = handleEndEncounter;
window.submitQuickAttack = submitQuickAttack;
window.submitQuickHeal = submitQuickHeal;
window.submitQuickSpell = submitQuickSpell;
window.submitQuickSkillCheck = submitQuickSkillCheck;
window.showAddEnemy = showAddEnemy;
window.submitAddEnemy = submitAddEnemy;
window.handleDamageEnemy = handleDamageEnemy;
window.handleRemoveEnemy = handleRemoveEnemy;
window.showQuickAttack = showQuickAttack;
window.showQuickHeal = showQuickHeal;
window.showQuickSpell = showQuickSpell;
window.showQuickSkillCheck = showQuickSkillCheck;
window.showQuickNote = showQuickNote;
window.rollD20 = rollD20;
window.showDiceRoller = showDiceRoller;
window.handleExportCampaign = handleExportCampaign;
window.loadPastEncounter = loadPastEncounter;
window.closeModal = closeModal;
