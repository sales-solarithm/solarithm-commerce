export interface RegisteredApp {
  id: string;
  name: string;
  code?: string;
  description?: string;
  category?: 'core' | 'operations' | 'finance' | 'sales' | string;
  status?: 'active' | 'maintenance' | 'beta';
  active: boolean;
  url: string;
  path?: string;
  icon: string;
  version?: string;
  allowedRoles?: string[];
  createdAt?: string;
}

/**
 * Solarithm OS Master App Registry
 * Structural registry preserving registered ecosystem applications.
 * Conforms directly to the Master Database Blueprint for registeredApps.
 */
export const appRegistry: RegisteredApp[] = [
  {
    id: 'solarithm-commerce',
    name: 'Solarithm Commerce',
    code: 'COMMERCE',
    description: 'Client acquisition, proposal management, and dynamic pricing engine',
    category: 'Sales',
    status: 'active',
    active: true,
    url: '/',
    path: '/',
    icon: 'Briefcase',
    version: '2.4.0',
    allowedRoles: ['sales', 'admin', 'owner']
  },
  {
    id: 'nexus-admin',
    name: 'Nexus Admin Console',
    code: 'NEXUS',
    description: 'System administration, user access control, global audit & factory reset',
    category: 'Core',
    status: 'active',
    active: true,
    url: '/',
    path: '/',
    icon: 'ShieldCheck',
    version: '3.1.0',
    allowedRoles: ['admin', 'owner']
  },
  {
    id: 'solarithm-designer',
    name: 'Solarithm Designer',
    code: 'DESIGNER',
    description: 'Engineering workspace, plant design, and CAD verification',
    category: 'Operations',
    status: 'active',
    active: true,
    url: '/designer',
    path: '/designer',
    icon: 'Layers',
    version: '1.9.5',
    allowedRoles: ['engineer', 'designer', 'admin', 'owner']
  },
  {
    id: 'solarithm-billing',
    name: 'Billing & Commissions',
    code: 'BILLING',
    description: 'Commission calculations, milestone invoicing, and salary history tracking',
    category: 'Finance',
    status: 'active',
    active: true,
    url: '/billing',
    path: '/billing',
    icon: 'BarChart3',
    version: '2.0.1',
    allowedRoles: ['finance', 'admin', 'owner']
  }
];
