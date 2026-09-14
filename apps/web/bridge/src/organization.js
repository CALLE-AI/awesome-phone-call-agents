const fs = require('node:fs');
const path = require('node:path');

const organizationPath = path.join(__dirname, '..', 'data', 'organization.json');

const defaultOrganization = {
  company: {
    id: 'quickmove',
    name: 'QuickMove Logistics'
  },
  people: [
    {
      id: 'arjun',
      name: 'Arjun',
      role: 'Driver',
      type: 'internal',
      phone: '+91******0878',
      responsibilities: ['Delivery execution', 'Vehicle status', 'Shipment location'],
      canDecide: ['Delivery status', 'Current location', 'Vehicle condition'],
      authority: {},
      connections: [{ personId: 'amit', reason: 'Warehouse and delivery coordination' }]
    },
    {
      id: 'amit',
      name: 'Amit',
      role: 'Warehouse Manager',
      type: 'internal',
      phone: '+91******1432',
      responsibilities: ['Warehouse dispatch', 'Replacement vehicles', 'Receiving capacity'],
      canDecide: ['Vehicle availability', 'Dispatch capacity'],
      authority: {},
      connections: [
        { personId: 'arjun', reason: 'Delivery coordination' },
        { personId: 'priya', reason: 'Expense escalation' }
      ]
    },
    {
      id: 'priya',
      name: 'Priya',
      role: 'Operations Head',
      type: 'internal',
      phone: '+91******9090',
      responsibilities: ['Operational approvals', 'Exception resolution'],
      canDecide: ['Additional operational spending'],
      authority: { extraCostLimit: 2000 },
      connections: [{ personId: 'amit', reason: 'Operational escalation' }]
    },
    {
      id: 'rahul',
      name: 'Rahul',
      role: 'Customer',
      type: 'customer',
      phone: '+91******2211',
      responsibilities: ['Receiving delivery'],
      canDecide: ['Delivery time acceptance'],
      authority: {},
      connections: []
    }
  ]
};

function ensureOrganizationFile() {
  const directory = path.dirname(organizationPath);

  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }

  if (!fs.existsSync(organizationPath)) {
    fs.writeFileSync(organizationPath, JSON.stringify(defaultOrganization, null, 2));
  }
}

function mergeOrganizationWithDefaults(organization) {
  const merged = JSON.parse(JSON.stringify(defaultOrganization));

  if (!organization || !organization.company || !Array.isArray(organization.people)) {
    return merged;
  }

  merged.company = { ...merged.company, ...organization.company };

  const existingById = new Map((organization.people || []).map((person) => [person.id, person]));

  merged.people = defaultOrganization.people.map((defaultPerson) => {
    const override = existingById.get(defaultPerson.id);
    return override ? { ...defaultPerson, ...override } : defaultPerson;
  });

  for (const person of organization.people) {
    if (!merged.people.some((entry) => entry.id === person.id)) {
      merged.people.push(person);
    }
  }

  return merged;
}

function loadOrganization() {
  ensureOrganizationFile();
  const raw = fs.readFileSync(organizationPath, 'utf8');
  try {
    const parsed = JSON.parse(raw);
    const merged = mergeOrganizationWithDefaults(parsed);
    saveOrganization(merged);
    return merged;
  } catch (error) {
    saveOrganization(defaultOrganization);
    return defaultOrganization;
  }
}

function saveOrganization(organization) {
  ensureOrganizationFile();
  fs.writeFileSync(organizationPath, JSON.stringify(organization, null, 2));
  return organization;
}

function getPerson(personId) {
  const organization = loadOrganization();
  return organization.people.find((person) => person.id === personId) || null;
}

function addPerson(personData) {
  const organization = loadOrganization();
  const nextPerson = {
    ...personData,
    responsibilities: personData.responsibilities || [],
    canDecide: personData.canDecide || [],
    authority: personData.authority || {},
    connections: personData.connections || []
  };

  organization.people.push(nextPerson);
  saveOrganization(organization);
  return nextPerson;
}

function updatePerson(personId, updates) {
  const organization = loadOrganization();
  const person = organization.people.find((entry) => entry.id === personId);

  if (!person) {
    throw new Error('Person not found');
  }

  Object.assign(person, updates);
  saveOrganization(organization);
  return person;
}

function removePerson(personId) {
  const organization = loadOrganization();
  const beforeLength = organization.people.length;
  organization.people = organization.people.filter((person) => person.id !== personId);

  if (organization.people.length === beforeLength) {
    throw new Error('Person not found');
  }

  saveOrganization(organization);
  return organization;
}

function resetOrganization() {
  const fresh = JSON.parse(JSON.stringify(defaultOrganization));
  saveOrganization(fresh);
  return fresh;
}

module.exports = {
  defaultOrganization,
  loadOrganization,
  saveOrganization,
  getPerson,
  addPerson,
  updatePerson,
  removePerson,
  resetOrganization
};