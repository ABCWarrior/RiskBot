require('dotenv').config();

const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');

const TOKEN     = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID  = process.env.GUILD_ID;
const DATA_FILE = './data.json';

const TEAM_COLOR = { RED: 0xe74c3c, BLUE: 0x3498db, YELLOW: 0xf1c40f };
const TEAM_EMOJI = { RED: '🔴', BLUE: '🔵', YELLOW: '🟡' };

// Edit these to match your actual map connections
const ADJACENCY = {
  FORINTHRY:  ['ISLANDS', 'MISTHALIN', 'PANTHEON'],
  ISLANDS:   ['FORINTHRY', 'KANDARIN','MISTHALIN', 'VARLAMORE'],
  KANDARIN:   ['ISLANDS', 'KOUREND', 'MISTHALIN', 'KHARID', 'PANTHEON', 'VARLAMORE'],
  KHARID:   ['KANDARIN', 'MISTHALIN'],
  KOUREND:   ['KANDARIN', 'VARLAMORE'],
  MISTHALIN:  ['FORINTHRY', 'ISLANDS', 'KANDARIN', 'KHARID', 'MORYTANIA', 'PANTHEON'],
  MORYTANIA:  ['MISTHALIN', 'VARLAMORE'],
  PANTHEON:  ['FORINTHRY', 'KANDARIN', 'MISTHALIN'],
  VARLAMORE:  ['ISLANDS', 'KANDARIN', 'KOUREND', 'MORYTANIA'],
};

// ── Data helpers ──────────────────────────────────────────────────────────────

function load() {
  if (!fs.existsSync(DATA_FILE)) return { regions: {} };
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function save(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function getRegion(data, name) {
  if (!data.regions[name]) data.regions[name] = { owner: null, balance: 0 };
  return data.regions[name];
}

function ownedBy(data, team) {
  return Object.entries(data.regions)
    .filter(([, r]) => r.owner === team)
    .map(([name]) => name);
}

function isAdjacentToOwned(data, team, target) {
  return ownedBy(data, team).some(r => (ADJACENCY[r] || []).includes(target));
}

// ── Scoring logic ─────────────────────────────────────────────────────────────
//
// Each region has one number: the owner's net lead (balance).
//   Own region:   balance += points          → FORTIFY
//   Neutral:      claim it, balance = points → EXPAND
//   Enemy region: net = balance - points
//     net > 0  → ATTACK      (enemy keeps it, balance reduced)
//     net = 0  → NEUTRALISED (goes neutral, next team claims it)
//     net < 0  → CONQUER     (you take it, balance = overflow)

function applyPoints(data, team, points, regionName) {
  const reg       = getRegion(data, regionName);
  const prevOwner = reg.owner;
  const prevBal   = reg.balance;
  let action, newOwner, newBal;

  if (prevOwner === team) {
    action = 'FORTIFY'; newOwner = team; newBal = prevBal + points;
  } else if (!prevOwner) {
    action = 'EXPAND';  newOwner = team; newBal = points;
  } else {
    const net = prevBal - points;
    if      (net > 0)  { action = 'ATTACK';      newOwner = prevOwner; newBal = net; }
    else if (net === 0) { action = 'NEUTRALISED'; newOwner = null;      newBal = 0;  }
    else                { action = 'CONQUER';     newOwner = team;      newBal = Math.abs(net); }
  }

  reg.owner   = newOwner;
  reg.balance = newBal;
  return { action, prevOwner, prevBal, newOwner, newBal, points };
}

// ── Embed builder ─────────────────────────────────────────────────────────────

function buildResultEmbed(username, team, regionName, r) {
  const { action, prevOwner, prevBal, newOwner, newBal, points } = r;
  const e = TEAM_EMOJI[team];

  const colors = { FORTIFY: 0x2ecc71, EXPAND: 0x1abc9c, ATTACK: 0xe67e22, NEUTRALISED: 0x95a5a6, CONQUER: TEAM_COLOR[team] };
  const icons  = { FORTIFY: '🛡️', EXPAND: '🏳️', ATTACK: '⚔️', NEUTRALISED: '⚖️', CONQUER: '👑' };

  let math;
  if (action === 'FORTIFY') {
    math = `${e} **${team}**: ${prevBal} + ${points} = **${newBal} pts**`;
  } else if (action === 'EXPAND') {
    math = `Region was neutral — ${e} **${team}** claims it with **${points} pts**`;
  } else if (action === 'ATTACK') {
    math = `${TEAM_EMOJI[prevOwner]} **${prevOwner}** had **${prevBal}** − ${e} **${team}** attacks **${points}** = **${newBal} pts** remaining for ${prevOwner}`;
  } else if (action === 'NEUTRALISED') {
    math = `${TEAM_EMOJI[prevOwner]} **${prevOwner}** had **${prevBal}** − ${e} **${team}** attacks **${points}** = **0**\n⚖️ Region is now **NEUTRAL** — next team to score here claims it!`;
  } else {
    math = `${TEAM_EMOJI[prevOwner]} **${prevOwner}** had **${prevBal}** − ${e} **${team}** attacks **${points}** = −${newBal}\n👑 ${e} **${team}** CONQUERS with **${newBal} pts** overflow`;
  }

  const ownerLine = newOwner ? `${TEAM_EMOJI[newOwner]} **${newOwner}** — ${newBal} pts` : '⚖️ **NEUTRAL**';

  return new EmbedBuilder()
    .setTitle(`${icons[action]} ${action} — ${regionName}`)
    .setColor(colors[action])
    .addFields(
      { name: 'Submitted by', value: `**${username}** (${e} ${team}) +${points} pts` },
      { name: 'Math',         value: math },
      { name: 'Current owner', value: ownerLine },
    )
    .setTimestamp();
}

// ── Commands ──────────────────────────────────────────────────────────────────

const commands = [
  new SlashCommandBuilder()
    .setName('risk')
    .setDescription('Submit a drop')
    .addStringOption(o => o.setName('team').setDescription('Your team').setRequired(true)
      .addChoices({ name: 'Red', value: 'RED' }, { name: 'Blue', value: 'BLUE' }, { name: 'Yellow', value: 'YELLOW' }))
    .addIntegerOption(o => o.setName('points').setDescription('Point value').setRequired(true).setMinValue(1))
    .addStringOption(o => o.setName('region').setDescription('Region name').setRequired(true)),

  new SlashCommandBuilder()
    .setName('risk-board')
    .setDescription('Show the current board'),

  // Use this to load in the current standings since the event already started
  new SlashCommandBuilder()
    .setName('risk-set')
    .setDescription('Admin: manually set a region owner and balance')
    .addStringOption(o => o.setName('region').setDescription('Region name').setRequired(true))
    .addStringOption(o => o.setName('owner').setDescription('Owner, or NEUTRAL').setRequired(true)
      .addChoices(
        { name: 'Red', value: 'RED' }, { name: 'Blue', value: 'BLUE' },
        { name: 'Yellow', value: 'YELLOW' }, { name: 'Neutral', value: 'NEUTRAL' }
      ))
    .addIntegerOption(o => o.setName('balance').setDescription('Current point balance (0 if neutral)').setRequired(true).setMinValue(0)),

].map(c => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  const route = GUILD_ID
    ? Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)
    : Routes.applicationCommands(CLIENT_ID);
  await rest.put(route, { body: commands });
  console.log('Commands registered.');
}

// ── Interaction handler ───────────────────────────────────────────────────────

async function handle(interaction) {
  if (!interaction.isChatInputCommand()) return;
  const data = load();
  const cmd  = interaction.commandName;

  if (cmd === 'risk-set') {
    const regionName = interaction.options.getString('region').toUpperCase();
    const ownerRaw   = interaction.options.getString('owner');
    const balance    = interaction.options.getInteger('balance');

    if (!ADJACENCY.hasOwnProperty(regionName))
      return interaction.reply({ content: `❌ Unknown region: **${regionName}**`, ephemeral: true });

    const reg   = getRegion(data, regionName);
    reg.owner   = ownerRaw === 'NEUTRAL' ? null : ownerRaw;
    reg.balance = reg.owner ? balance : 0;
    save(data);

    const ownerLine = reg.owner ? `${TEAM_EMOJI[reg.owner]} **${reg.owner}** — ${balance} pts` : '⚖️ **NEUTRAL**';
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle(`🔧 Set — ${regionName}`)
          .setColor(0x9b59b6)
          .addFields({ name: 'Region is now', value: ownerLine })
      ]
    });
  }

  if (cmd === 'risk-board') {
    const lines = Object.keys(ADJACENCY).map(region => {
      const reg = data.regions[region];
      if (!reg || !reg.owner) return `⚖️ **${region}** — Neutral`;
      return `${TEAM_EMOJI[reg.owner]} **${region}** — ${reg.owner} (${reg.balance} pts)`;
    });

    const counts = { RED: 0, BLUE: 0, YELLOW: 0 };
    for (const reg of Object.values(data.regions)) if (reg.owner) counts[reg.owner]++;

    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('🗺️ RISK — Board')
          .setColor(0x9b59b6)
          .setDescription(lines.join('\n'))
          .addFields({ name: 'Totals', value: Object.entries(counts).map(([t, c]) => `${TEAM_EMOJI[t]} ${t}: **${c}**`).join('  |  ') })
          .setTimestamp()
      ]
    });
  }

  if (cmd === 'risk') {
    const team       = interaction.options.getString('team').toUpperCase();
    const points     = interaction.options.getInteger('points');
    const regionName = interaction.options.getString('region').toUpperCase();
    const username   = interaction.user.username;

    if (!ADJACENCY.hasOwnProperty(regionName))
      return interaction.reply({ content: `❌ Unknown region: **${regionName}**\nValid: ${Object.keys(ADJACENCY).join(', ')}`, ephemeral: true });

    const owned = ownedBy(data, team);

    const RE_ENTRY_ZONES = ['PANTHEON', 'ISLANDS'];
    const isReEntry = RE_ENTRY_ZONES.includes(regionName) && owned.length === 0;

    if (!isReEntry && !owned.includes(regionName) && !isAdjacentToOwned(data, team, regionName))
      return interaction.reply({ content: `❌ **${regionName}** isn't adjacent to any region **${team}** owns.\nYou own: ${owned.join(', ') || 'none'}\n💡 Teams with no territory can only submit to **PANTHEON** or **ISLANDS**.`, ephemeral: true });

    const result = applyPoints(data, team, points, regionName);
    save(data);
    return interaction.reply({ embeds: [buildResultEmbed(username, team, regionName, result)] });
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await registerCommands();
});

client.on('interactionCreate', async interaction => {
  try {
    await handle(interaction);
  } catch (err) {
    console.error(err);
    const msg = { content: '❌ Something went wrong.', ephemeral: true };
    interaction.replied ? interaction.followUp(msg) : interaction.reply(msg);
  }
});

client.login(TOKEN);
