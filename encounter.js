// ============================================================================
// D&D 5e Combat Tracker - Core Encounter System
// Based on app.md blueprint (Sections 3-6)
// ============================================================================

// Global campaign data (loaded from encounter-data.json)
let campaignData = null;

// Current active encounter (in-memory, fast, mutable)
let currentEncounter = null;

// ============================================================================
// EVENT TYPES (Section 4)
// ============================================================================

const EVENT_TYPES = {
  // Combat Actions
  ATTACK_HIT: "attack_hit",
  ATTACK_MISS: "attack_miss",
  ATTACK_CRIT: "attack_crit",
  ATTACK_FUMBLE: "attack_fumble",

  // Damage & Healing
  DAMAGE_DEALT: "damage_dealt",
  DAMAGE_TAKEN: "damage_taken",
  HEALING_DONE: "healing_done",
  HEALING_RECEIVED: "healing_received",
  TEMP_HP_GAINED: "temp_hp_gained",

  // Status & Effects
  CONDITION_APPLIED: "condition_applied",
  CONDITION_REMOVED: "condition_removed",
  SPELL_CAST: "spell_cast",
  SPELL_SLOT_USED: "spell_slot_used",

  // Skill Checks & Saves
  SKILL_CHECK: "skill_check",
  SAVING_THROW: "saving_throw",
  ABILITY_CHECK: "ability_check",

  // Resources
  RESOURCE_USED: "resource_used",
  RESOURCE_REGAINED: "resource_regained",

  // Combat Flow
  INITIATIVE_ROLLED: "initiative_rolled",
  TURN_START: "turn_start",
  TURN_END: "turn_end",
  ROUND_START: "round_start",
  ROUND_END: "round_end",

  // Special
  DEATH_SAVE: "death_save",
  ENEMY_DEFEATED: "enemy_defeated",
  PLAYER_DOWN: "player_down",
  PLAYER_STABILIZED: "player_stabilized",

  // General
  NOTE: "note",
};

// ============================================================================
// CORE EVENT LOGGING (Section 5)
// ============================================================================

// Generate unique event ID
function generateEventId() {
  return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
}

// Base event logger - all events go through here
function logEvent(type, actor, target = null, data = {}) {
  if (!currentEncounter) {
    console.warn("No active encounter. Cannot log event.");
    return null;
  }

  const event = {
    id: generateEventId(),
    time: Date.now(),
    round: currentEncounter.currentRound,
    type,
    actor,
    target,
    data,
  };

  currentEncounter.events.push(event);

  // Invalidate stats cache
  currentEncounter.statsVersion++;

  // Emit event for real-time UI updates
  if (typeof emitEventUpdate === "function") {
    emitEventUpdate(event);
  }

  return event;
}

// ============================================================================
// QUICK-ENTRY HELPER FUNCTIONS (Section 5)
// ============================================================================

// === COMBAT QUICK ENTRIES ===

function logAttackHit(attacker, target, damage, options = {}) {
  return logEvent("attack_hit", attacker, target, {
    attackRoll: options.attackRoll || 0,
    targetAC: options.targetAC || 0,
    damageRoll: options.damageRoll || "",
    damageTotal: damage,
    damageType: options.damageType || "slashing",
    weapon: options.weapon || "weapon",
    isCrit: options.isCrit || false,
  });
}

function logAttackMiss(attacker, target, attackRoll = 0) {
  return logEvent("attack_miss", attacker, target, {
    attackRoll,
    targetAC: 0,
  });
}

function logCriticalHit(attacker, target, damage, options = {}) {
  return logEvent("attack_crit", attacker, target, {
    attackRoll: options.attackRoll || 20,
    damageRoll: options.damageRoll || "",
    damageTotal: damage,
    damageType: options.damageType || "slashing",
    weapon: options.weapon || "weapon",
  });
}

function logDamageTaken(target, damage, damageType = "untyped", source = "") {
  return logEvent("damage_taken", source || "enemy", target, {
    damageTotal: damage,
    damageType,
    source,
  });
}

function logHealing(healer, target, healing, source = "healing") {
  return logEvent("healing_done", healer, target, {
    healingRoll: "",
    healingTotal: healing,
    source,
  });
}

// === SPELL CASTING ===

function logSpellCast(
  caster,
  spellName,
  spellLevel,
  targets = [],
  results = []
) {
  return logEvent(
    "spell_cast",
    caster,
    targets.length > 1 ? "area" : targets[0],
    {
      spellName,
      spellLevel,
      targets,
      results,
    }
  );
}

// === SKILL CHECKS & SAVES ===

function logSkillCheck(actor, skill, roll, dc, success) {
  return logEvent("skill_check", actor, null, {
    skill,
    roll,
    dc,
    success,
  });
}

function logSavingThrow(actor, saveType, roll, dc, success) {
  return logEvent("saving_throw", actor, null, {
    saveType,
    roll,
    dc,
    success,
  });
}

// === DEATH SAVES ===

function logDeathSave(actor, roll, success) {
  const deathSaves = getPlayerDeathSaves(actor);

  if (success) {
    deathSaves.successes++;
  } else {
    deathSaves.failures++;
  }

  return logEvent("death_save", actor, null, {
    roll,
    success,
    currentSuccesses: deathSaves.successes,
    currentFailures: deathSaves.failures,
  });
}

function getPlayerDeathSaves(playerId) {
  const deathSaveEvents = currentEncounter.events.filter(
    (e) => e.actor === playerId && e.type === "death_save"
  );

  let successes = 0;
  let failures = 0;

  deathSaveEvents.forEach((e) => {
    if (e.data.success) successes++;
    else failures++;
  });

  return { successes, failures };
}

// === ROUND MANAGEMENT ===

function startNewRound() {
  if (!currentEncounter) return null;

  currentEncounter.currentRound++;
  return logEvent("round_start", "DM", null, {
    roundNumber: currentEncounter.currentRound,
  });
}

function endRound() {
  return logEvent("round_end", "DM", null, {
    roundNumber: currentEncounter.currentRound,
  });
}

// === ENEMY MANAGEMENT ===

function logEnemyDefeated(enemyId, killedBy) {
  const enemy = getEnemy(enemyId);
  return logEvent("enemy_defeated", killedBy, enemyId, {
    enemyName: enemy ? enemy.name : "Unknown",
    finalBlow: true,
  });
}

// === NOTES ===

function logNote(text, actor = "DM") {
  return logEvent("note", actor, null, {
    text,
  });
}

// ============================================================================
// AUTO-CALCULATED STATISTICS (Section 5A)
// ============================================================================

function getPlayerStats(playerId) {
  if (!currentEncounter) return null;

  // Check cache
  if (
    currentEncounter.cachedStats[playerId] &&
    currentEncounter.cachedStats[playerId].version ===
      currentEncounter.statsVersion
  ) {
    return currentEncounter.cachedStats[playerId].stats;
  }

  const events = currentEncounter.events.filter(
    (e) => e.actor === playerId || e.target === playerId
  );

  let stats = {
    totalDamageDealt: 0,
    totalDamageTaken: 0,
    damageByType: {},

    totalHealingDone: 0,
    totalHealingReceived: 0,
    healingCasts: 0,

    totalAttacks: 0,
    attacksHit: 0,
    attacksMissed: 0,
    criticalHits: 0,
    hitRate: 0,

    enemiesDefeated: 0,

    spellsCast: 0,
    spellSlotsByLevel: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 },

    skillChecks: { total: 0, successes: 0, failures: 0 },
    savingThrows: { total: 0, successes: 0, failures: 0 },

    deathSaves: { successes: 0, failures: 0 },

    dps: 0,
    averageDamagePerHit: 0,
    roundsActive: 0,
  };

  events.forEach((event) => {
    switch (event.type) {
      case "attack_hit":
      case "attack_crit":
        if (event.actor === playerId) {
          stats.totalAttacks++;
          stats.attacksHit++;
          stats.totalDamageDealt += event.data.damageTotal || 0;

          const dmgType = event.data.damageType || "untyped";
          stats.damageByType[dmgType] =
            (stats.damageByType[dmgType] || 0) + event.data.damageTotal;

          if (event.type === "attack_crit") {
            stats.criticalHits++;
          }
        }
        break;

      case "attack_miss":
        if (event.actor === playerId) {
          stats.totalAttacks++;
          stats.attacksMissed++;
        }
        break;

      case "damage_taken":
        if (event.target === playerId) {
          stats.totalDamageTaken += event.data.damageTotal || 0;
        }
        break;

      case "healing_done":
        if (event.actor === playerId) {
          stats.totalHealingDone += event.data.healingTotal || 0;
          stats.healingCasts++;
        }
        if (event.target === playerId) {
          stats.totalHealingReceived += event.data.healingTotal || 0;
        }
        break;

      case "spell_cast":
        if (event.actor === playerId) {
          stats.spellsCast++;
          const level = event.data.spellLevel || 0;
          if (level > 0 && level <= 9) {
            stats.spellSlotsByLevel[level]++;
          }
        }
        break;

      case "enemy_defeated":
        if (event.actor === playerId) {
          stats.enemiesDefeated++;
        }
        break;

      case "skill_check":
        if (event.actor === playerId) {
          stats.skillChecks.total++;
          if (event.data.success) {
            stats.skillChecks.successes++;
          } else {
            stats.skillChecks.failures++;
          }
        }
        break;

      case "saving_throw":
        if (event.actor === playerId) {
          stats.savingThrows.total++;
          if (event.data.success) {
            stats.savingThrows.successes++;
          } else {
            stats.savingThrows.failures++;
          }
        }
        break;

      case "death_save":
        if (event.actor === playerId) {
          if (event.data.success) {
            stats.deathSaves.successes++;
          } else {
            stats.deathSaves.failures++;
          }
        }
        break;
    }
  });

  // Calculate derived stats
  if (stats.totalAttacks > 0) {
    stats.hitRate = ((stats.attacksHit / stats.totalAttacks) * 100).toFixed(1);
    stats.averageDamagePerHit =
      stats.attacksHit > 0
        ? (stats.totalDamageDealt / stats.attacksHit).toFixed(1)
        : 0;
  }

  // Calculate average healing per cast
  if (stats.healingCasts > 0) {
    stats.averageHealingPerCast = (
      stats.totalHealingDone / stats.healingCasts
    ).toFixed(1);
  } else {
    stats.averageHealingPerCast = 0;
  }

  // Calculate DPS
  const encounterDuration = (Date.now() - currentEncounter.startTime) / 1000;
  if (encounterDuration > 0) {
    stats.dps = (stats.totalDamageDealt / encounterDuration).toFixed(2);
    stats.hps = (stats.totalHealingDone / encounterDuration).toFixed(2);
  }

  stats.roundsActive = currentEncounter.currentRound;

  // Cache stats
  currentEncounter.cachedStats[playerId] = {
    stats,
    version: currentEncounter.statsVersion,
  };

  return stats;
}

// Quick stat lookups
function getPlayerDPS(playerId) {
  return getPlayerStats(playerId)?.dps || 0;
}

function getPlayerHitRate(playerId) {
  return getPlayerStats(playerId)?.hitRate || 0;
}

function getPlayerKills(playerId) {
  return getPlayerStats(playerId)?.enemiesDefeated || 0;
}

// Get all party stats
function getAllPartyStats() {
  if (!currentEncounter) return [];

  return currentEncounter.party.map((member) => ({
    ...member,
    stats: getPlayerStats(member.id),
  }));
}

// Get top performer
function getTopPerformer(metric = "totalDamageDealt") {
  const allStats = getAllPartyStats();
  return allStats.reduce(
    (top, current) =>
      current.stats[metric] > (top.stats?.[metric] || 0) ? current : top,
    allStats[0] || {}
  );
}

// ============================================================================
// ENCOUNTER MANAGEMENT (Section 6)
// ============================================================================

// Start a new encounter
function startNewEncounter(name, partyMembers = []) {
  // Ensure each party member has currentHp set to maxHp
  const partyWithHP = partyMembers.map((member) => ({
    ...member,
    currentHp: member.currentHp !== undefined ? member.currentHp : member.maxHp,
  }));

  currentEncounter = {
    id: `enc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    name,
    startTime: Date.now(),
    endTime: null,
    currentRound: 1,
    events: [],
    party: partyWithHP,
    enemies: [],
    enemiesMap: new Map(),
    cachedStats: {},
    statsVersion: 0,
  };

  // Log encounter start
  logEvent("round_start", "DM", null, { roundNumber: 1 });

  return currentEncounter;
}

// Finalize encounter and save to campaign
function finalizeEncounter() {
  if (!currentEncounter || !campaignData) {
    console.warn("No active encounter or campaign data");
    return false;
  }

  // Set end time
  currentEncounter.endTime = Date.now();

  // Calculate final stats for all players
  currentEncounter.finalStats = {};
  currentEncounter.party.forEach((member) => {
    currentEncounter.finalStats[member.id] = getPlayerStats(member.id);
  });

  // Calculate encounter summary
  currentEncounter.summary = {
    duration: currentEncounter.endTime - currentEncounter.startTime,
    totalRounds: currentEncounter.currentRound,
    totalEvents: currentEncounter.events.length,
    totalDamageDealt: Object.values(currentEncounter.finalStats).reduce(
      (sum, s) => sum + s.totalDamageDealt,
      0
    ),
    totalHealingDone: Object.values(currentEncounter.finalStats).reduce(
      (sum, s) => sum + s.totalHealingDone,
      0
    ),
    enemiesDefeated: currentEncounter.enemies.filter((e) => e.hp <= 0).length,
    mvp: getTopPerformer("totalDamageDealt").name || "Unknown",
  };

  // Save to campaign data
  campaignData.encounters.push(currentEncounter);

  // Auto-save to localStorage
  saveCampaignData();

  // Clear current encounter
  const finalized = currentEncounter;
  currentEncounter = null;

  return finalized;
}

// Add enemy to encounter
function addEnemy(name, hp, ac, additionalData = {}) {
  if (!currentEncounter) {
    console.warn("No active encounter");
    return null;
  }

  const enemy = {
    id: `enemy_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    name,
    hp,
    maxHp: hp,
    ac,
    ...additionalData,
  };

  currentEncounter.enemies.push(enemy);
  currentEncounter.enemiesMap.set(enemy.id, enemy);
  logNote(`${name} joined the battle!`);

  return enemy;
}

// Get enemy by ID
function getEnemy(enemyId) {
  if (!currentEncounter) return null;
  return currentEncounter.enemiesMap.get(enemyId);
}

// Update enemy HP
function updateEnemyHP(enemyId, newHP) {
  const enemy = getEnemy(enemyId);
  if (enemy) {
    const oldHP = enemy.hp;
    enemy.hp = Math.max(0, Math.min(newHP, enemy.maxHp));

    if (enemy.hp === 0 && oldHP > 0) {
      logNote(`${enemy.name} has been defeated!`);
    }

    return enemy;
  }
  return null;
}

// Remove enemy from encounter
function removeEnemy(enemyId) {
  if (!currentEncounter) return false;

  const enemy = currentEncounter.enemiesMap.get(enemyId);
  if (enemy) {
    const index = currentEncounter.enemies.findIndex((e) => e.id === enemyId);
    if (index > -1) {
      currentEncounter.enemies.splice(index, 1);
    }
    currentEncounter.enemiesMap.delete(enemyId);
    logNote(`${enemy.name} removed from battle.`);
    return true;
  }
  return false;
}

// ============================================================================
// PARTY MEMBER HP MANAGEMENT
// ============================================================================

// Get party member by ID
function getPartyMember(memberId) {
  if (!currentEncounter) return null;
  return currentEncounter.party.find((m) => m.id === memberId);
}

// Update party member HP
function updatePartyMemberHP(memberId, newHP) {
  const member = getPartyMember(memberId);
  if (member) {
    member.currentHp = Math.max(0, Math.min(newHP, member.maxHp));

    // Check if member went down
    if (member.currentHp === 0) {
      logEvent("player_down", memberId, null, {
        name: member.name,
      });
    }

    return member;
  }
  return null;
}

// Apply damage to party member
function damagePartyMember(memberId, damage) {
  const member = getPartyMember(memberId);
  if (member) {
    const oldHP = member.currentHp;
    const newHP = member.currentHp - damage;
    updatePartyMemberHP(memberId, newHP);
    // Return actual damage applied
    const actualDamage = oldHP - member.currentHp;
    return { member, actualDamage };
  }
  return null;
}

// Heal party member
function healPartyMember(memberId, healing) {
  const member = getPartyMember(memberId);
  if (member) {
    const oldHP = member.currentHp;
    const newHP = member.currentHp + healing;
    updatePartyMemberHP(memberId, newHP);
    // Return actual healing applied (capped at maxHp)
    const actualHealing = member.currentHp - oldHP;
    return { member, actualHealing };
  }
  return null;
}

// ============================================================================
// DATA PERSISTENCE (Section 7)
// ============================================================================

// Load campaign data from JSON file or localStorage
async function loadCampaignData() {
  try {
    // Try localStorage first
    const localData = localStorage.getItem("dnd_campaign_data");
    if (localData) {
      campaignData = JSON.parse(localData);
      console.log("Campaign data loaded from localStorage");
      return campaignData;
    }

    // Fall back to JSON file
    const response = await fetch("encounter-data.json");
    campaignData = await response.json();
    console.log("Campaign data loaded from encounter-data.json");
    return campaignData;
  } catch (error) {
    // If the response was an HTML error page (contains DOCTYPE), log a warning and fall back to defaults.
    if (
      (error && typeof error === "string" && error.includes("DOCTYPE")) ||
      (error && error.message && error.message.includes("DOCTYPE")) ||
      String(error).includes("DOCTYPE")
    ) {
      console.warn(
        "Received HTML instead of JSON when loading campaign data; falling back to defaults."
      );
    } else {
      console.error("Error loading campaign data:", error);
    }
    // Initialize with default structure
    campaignData = {
      campaignName: "New Campaign",
      campaignId: `camp_${Date.now()}`,
      lastUpdated: Date.now(),
      party: [],
      encounters: [],
    };
    return campaignData;
  }
}

// Save campaign data to localStorage
function saveCampaignData() {
  if (!campaignData) return false;

  campaignData.lastUpdated = Date.now();
  try {
    localStorage.setItem(
      "dnd_campaign_data",
      JSON.stringify(campaignData, null, 2)
    );
    console.log("Campaign data saved to localStorage");
    return true;
  } catch (error) {
    if (error.name === "QuotaExceededError") {
      console.error("LocalStorage quota exceeded. Cannot save campaign data.");
      alert("Storage limit reached. Please export your campaign data.");
    } else {
      console.error("Error saving campaign data:", error);
    }
    return false;
  }
}

// Export campaign data as JSON file
function exportCampaignData() {
  if (!campaignData) return;

  const blob = new Blob([JSON.stringify(campaignData, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "encounter-data.json";
  //a.download = `campaign_${campaignData.campaignName}_${Date.now()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 200);
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

// Get current encounter
function getCurrentEncounter() {
  return currentEncounter;
}

// Get campaign data
function getCampaignData() {
  return campaignData;
}

// Check if encounter is active
function isEncounterActive() {
  return currentEncounter !== null;
}
