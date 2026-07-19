/**
 * Fictional demo worlds for Beacon. These are data-only definitions: the
 * seed runner supplies IDs, timestamps, inventory, alerts, jobs, and SQL.
 * Do not add assets, logos, or dialogue excerpts from the source material.
 */

function world(id, title, description, sites, devices, groups, incidents) {
  return { id, title, description, sites, devices, groups, incidents };
}

export const WORLDS = {
  matrix: world('matrix', 'The Matrix', 'Zion and hovercraft operations', [
    { key: 'zion', name: 'Zion Council', contact: 'Commander Lock', location: 'Earth Core' },
    { key: 'nebuchadnezzar', name: 'Nebuchadnezzar', contact: 'Morpheus', location: 'Zion Docking Bay 7' },
    { key: 'oracle', name: 'Oracle Network', contact: 'The Oracle', location: 'Simulation Layer' },
  ], [
    ['zion-ops-01', 'zion', 'zion-ops-01', 'Operator Console', 'linux', 'workstation', true, 'protected'],
    ['zion-archive', 'zion', 'zion-archive-01', 'Archive Server', 'linux', 'server', true, 'protected'],
    ['zion-relay', 'zion', 'zion-relay-01', 'Relay Gateway', 'windows', 'server', false, 'outdated'],
    ['neb-bridge', 'nebuchadnezzar', 'neb-bridge-01', 'Bridge Console', 'windows', 'workstation', true, 'protected'],
    ['trinity-laptop', 'nebuchadnezzar', 'trinity-field-01', 'Field Laptop', 'windows', 'laptop', true, 'protected'],
    ['tank-console', 'nebuchadnezzar', 'tank-console-01', 'Tank Console', 'linux', 'workstation', false, 'unknown'],
    ['oracle-relay', 'oracle', 'oracle-relay-01', 'Prediction Relay', 'linux', 'server', true, 'protected'],
    ['smith-node', 'oracle', 'smith-node-01', 'Anomaly Node', 'windows', 'server', false, 'outdated'],
    ['construct-lab', 'oracle', 'construct-lab-01', 'Construct Lab', 'macos', 'workstation', true, 'protected'],
  ], [
    { name: 'Nebuchadnezzar Crew', members: ['neb-bridge', 'trinity-laptop', 'tank-console'] },
    { name: 'Simulation Relays', members: ['zion-relay', 'oracle-relay', 'smith-node'] },
  ], [
    ['zion-relay', 'offline', 'critical', 42], ['smith-node', 'cpu_usage', 'high', 18], ['tank-console', 'av_status', 'moderate', 8],
  ]),

  minecraft: world('minecraft', 'Minecraft', 'Overworld, Nether, and End operations', [
    { key: 'overworld', name: 'Overworld Villages', contact: 'Village Librarian', location: 'Plains Biome' },
    { key: 'nether', name: 'Nether Transit Authority', contact: 'Piglin Quartermaster', location: 'Nether Hub' },
    { key: 'end', name: 'End Research Expedition', contact: 'Ender Researcher', location: 'The End' },
  ], [
    ['village-ledger', 'overworld', 'village-ledger-01', 'Trade Ledger', 'windows', 'workstation', true, 'protected'],
    ['redstone-controller', 'overworld', 'redstone-controller-01', 'Redstone Controller', 'linux', 'server', true, 'protected'],
    ['iron-farm', 'overworld', 'iron-farm-01', 'Iron Farm Monitor', 'linux', 'server', false, 'outdated'],
    ['nether-gateway', 'nether', 'nether-gateway-01', 'Portal Gateway', 'linux', 'server', true, 'protected'],
    ['blaze-laptop', 'nether', 'blaze-ops-01', 'Blaze Operations Laptop', 'windows', 'laptop', true, 'protected'],
    ['piglin-ledger', 'nether', 'piglin-ledger-01', 'Barter Ledger', 'windows', 'workstation', false, 'unknown'],
    ['end-relay', 'end', 'end-relay-01', 'Ender Relay', 'linux', 'server', true, 'protected'],
    ['stronghold-map', 'end', 'stronghold-map-01', 'Stronghold Mapping Station', 'macos', 'workstation', true, 'protected'],
    ['dragon-watch', 'end', 'dragon-watch-01', 'Dragon Watch Sensor', 'linux', 'server', false, 'outdated'],
  ], [
    { name: 'Redstone Infrastructure', members: ['redstone-controller', 'iron-farm', 'nether-gateway'] },
    { name: 'End Expedition', members: ['end-relay', 'stronghold-map', 'dragon-watch'] },
  ], [
    ['iron-farm', 'disk_space', 'high', 35], ['piglin-ledger', 'offline', 'moderate', 25], ['dragon-watch', 'offline', 'critical', 55],
  ]),

  'holy-grail': world('holy-grail', 'Monty Python and the Holy Grail', 'Arthurian quest operations', [
    { key: 'camelot', name: 'Camelot', contact: 'King Arthur', location: 'The Round Table' },
    { key: 'swamp', name: 'Swamp Castle', contact: 'Sir Lancelot', location: 'The Swamp' },
    { key: 'anthrax', name: 'Castle Anthrax', contact: 'Zoot', location: 'Forest of Ewing' },
  ], [
    ['round-table', 'camelot', 'round-table-01', 'Round Table Console', 'windows', 'workstation', true, 'protected'],
    ['grail-archive', 'camelot', 'grail-archive-01', 'Grail Archive', 'linux', 'server', true, 'protected'],
    ['ni-relay', 'camelot', 'ni-relay-01', 'Knights Relay', 'linux', 'server', false, 'outdated'],
    ['swamp-bridge', 'swamp', 'swamp-bridge-01', 'Swamp Bridge Console', 'windows', 'workstation', true, 'protected'],
    ['lancelot-laptop', 'swamp', 'lancelot-field-01', 'Quest Laptop', 'windows', 'laptop', true, 'protected'],
    ['taunt-server', 'swamp', 'taunt-server-01', 'Taunt Gateway', 'linux', 'server', false, 'unknown'],
    ['anthrax-reception', 'anthrax', 'anthrax-reception-01', 'Reception Desk', 'macos', 'workstation', true, 'protected'],
    ['rabbit-watch', 'anthrax', 'rabbit-watch-01', 'Rabbit Watch Sensor', 'linux', 'server', false, 'outdated'],
    ['grail-map', 'anthrax', 'grail-map-01', 'Quest Map Station', 'linux', 'workstation', true, 'protected'],
  ], [
    { name: 'Knights of the Round Table', members: ['round-table', 'grail-archive', 'lancelot-laptop'] },
    { name: 'Quest Perimeter', members: ['ni-relay', 'taunt-server', 'rabbit-watch'] },
  ], [
    ['ni-relay', 'offline', 'high', 33], ['taunt-server', 'cpu_usage', 'moderate', 14], ['rabbit-watch', 'offline', 'critical', 61],
  ]),

  fallout: world('fallout', 'Fallout', 'Mojave and Vault-Tec operations', [
    { key: 'vault33', name: 'Vault 33', contact: 'Vault Overseer', location: 'Southern California' },
    { key: 'newvegas', name: 'New Vegas', contact: 'Mr. House', location: 'Mojave Wasteland' },
    { key: 'ncr', name: 'NCR Mojave Outpost', contact: 'NCR Quartermaster', location: 'Hoover Dam Approach' },
  ], [
    ['vault-terminal', 'vault33', 'vault-terminal-01', 'Vault Administration Terminal', 'windows', 'workstation', true, 'protected'],
    ['vault-water', 'vault33', 'vault-water-01', 'Water Chip Controller', 'linux', 'server', true, 'protected'],
    ['vault-comms', 'vault33', 'vault-comms-01', 'Vault Communications', 'linux', 'server', false, 'outdated'],
    ['lucky38', 'newvegas', 'lucky38-core-01', 'Lucky 38 Core', 'linux', 'server', true, 'protected'],
    ['securitron', 'newvegas', 'securitron-ops-01', 'Securitron Operations', 'windows', 'workstation', true, 'protected'],
    ['strip-relay', 'newvegas', 'strip-relay-01', 'Strip Relay', 'windows', 'server', false, 'unknown'],
    ['ncr-command', 'ncr', 'ncr-command-01', 'NCR Command Desk', 'windows', 'workstation', true, 'protected'],
    ['hoover-sensor', 'ncr', 'hoover-sensor-01', 'Hoover Dam Sensor', 'linux', 'server', false, 'outdated'],
    ['ranger-laptop', 'ncr', 'ranger-field-01', 'Ranger Field Laptop', 'windows', 'laptop', true, 'protected'],
  ], [
    { name: 'Vault Critical Systems', members: ['vault-water', 'vault-comms', 'lucky38'] },
    { name: 'Mojave Field Operations', members: ['securitron', 'ncr-command', 'ranger-laptop'] },
  ], [
    ['vault-comms', 'offline', 'critical', 48], ['strip-relay', 'disk_space', 'high', 22], ['hoover-sensor', 'offline', 'critical', 70],
  ]),

  'star-trek': world('star-trek', 'Star Trek', 'Federation fleet and starbase operations', [
    { key: 'academy', name: 'Starfleet Academy', contact: 'Academy Operations', location: 'San Francisco, Earth' },
    { key: 'enterprise', name: 'USS Enterprise', contact: 'Captain Pike', location: 'Federation Space' },
    { key: 'ds9', name: 'Deep Space 9', contact: 'Station Operations', location: 'Bajoran Sector' },
  ], [
    ['academy-lab', 'academy', 'academy-lab-01', 'Cadet Systems Lab', 'macos', 'workstation', true, 'protected'],
    ['academy-sim', 'academy', 'academy-sim-01', 'Holodeck Simulator', 'linux', 'server', true, 'protected'],
    ['academy-comms', 'academy', 'academy-comms-01', 'Campus Communications', 'windows', 'server', false, 'outdated'],
    ['enterprise-bridge', 'enterprise', 'enterprise-bridge-01', 'Bridge Console', 'windows', 'workstation', true, 'protected'],
    ['enterprise-warp', 'enterprise', 'enterprise-warp-01', 'Warp Core Monitor', 'linux', 'server', true, 'protected'],
    ['enterprise-away', 'enterprise', 'enterprise-away-01', 'Away Team Laptop', 'windows', 'laptop', false, 'unknown'],
    ['ds9-ops', 'ds9', 'ds9-ops-01', 'Station Operations', 'linux', 'workstation', true, 'protected'],
    ['ds9-docking', 'ds9', 'ds9-docking-01', 'Docking Control', 'linux', 'server', false, 'outdated'],
    ['ds9-medical', 'ds9', 'ds9-medical-01', 'Infirmary Console', 'macos', 'workstation', true, 'protected'],
  ], [
    { name: 'Starfleet Critical Systems', members: ['academy-sim', 'enterprise-warp', 'ds9-docking'] },
    { name: 'Away and Field Systems', members: ['enterprise-away', 'academy-lab', 'ds9-medical'] },
  ], [
    ['academy-comms', 'offline', 'high', 29], ['enterprise-away', 'av_status', 'moderate', 12], ['ds9-docking', 'offline', 'critical', 64],
  ]),
};

export function worldNames() {
  return Object.keys(WORLDS);
}

export function validateWorld(world) {
  const sites = new Set(world.sites.map(site => site.key));
  const devices = new Set(world.devices.map(device => device[0]));
  if (sites.size !== world.sites.length || devices.size !== world.devices.length) throw new Error(`${world.id}: duplicate site or device key`);
  for (const [, site] of world.devices) if (!sites.has(site)) throw new Error(`${world.id}: device references unknown site ${site}`);
  for (const group of world.groups) for (const device of group.members) if (!devices.has(device)) throw new Error(`${world.id}: group references unknown device ${device}`);
  for (const [device] of world.incidents) if (!devices.has(device)) throw new Error(`${world.id}: incident references unknown device ${device}`);
}

for (const definition of Object.values(WORLDS)) validateWorld(definition);
