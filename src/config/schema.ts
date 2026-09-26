export const COLLECTIONS = {
  USERS: 'users',
  EMPLOYEES: 'employees',
  APPROVALS: 'approvals',
  REGISTERED_APPS: 'registeredApps',
  AUDIT_LOGS: 'auditLogs',
  CLIENTS: 'clients',
  PROJECTS: 'projects',
  APPS: 'registeredApps', // backwards-compatible alias
  SCOPES: 'scopes',
  PRICING_RULES: 'pricingRules',
  PROPOSALS: 'proposals',
  CHANGE_REQUESTS: 'changeRequests',
  INVOICES: 'invoices',
  PAYMENTS: 'payments',
  LEDGER: 'ledger'
} as const;

export const APPROVAL_TYPES = {
  PASSWORD_RESET_REQUEST: 'PASSWORD_RESET_REQUEST'
} as const;

export const APPROVAL_STATUS = {
  PENDING: 'pending',
  PENDING_UPPER: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'rejected'
} as const;

export interface ApprovalRequest {
  id?: string;
  type: 'PASSWORD_RESET_REQUEST';
  requestedEmail: string;
  email?: string;
  appName?: string;
  appId?: string;
  employeeName?: string;
  name?: string;
  employeeId?: string;
  reason?: string;
  status: 'pending' | 'PENDING' | 'APPROVED' | 'rejected';
  timestamp: any;
  createdAt?: string;
  tempPassword?: string;
  resolvedAt?: string;
  resolvedBy?: string;
}

export interface EmployeeRecord {
  id?: string;
  email: string;
  name: string;
  phone: string;
  department: string;
  designation: string;
  role: string;
  employeeId: string;
  dateOfJoining?: string;
  dateOfBirth?: string;
  bankName?: string;
  accountNumber?: string;
  ifscCode?: string;
  panCardNumber?: string;
  aadhaarCardNumber?: string;
  houseAddress?: string;
  personalEmailAddress?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface UserRecord extends Partial<EmployeeRecord> {
  id?: string;
  assignedRole?: 'owner' | 'admin' | 'sales' | 'employee' | string;
  accessibleApps?: string[];
}

export interface RegisteredAppItem {
  id?: string;
  name: string;
  url: string;
  description?: string;
  icon?: string;
  category?: string;
  active: boolean;
  allowedRoles?: string[];
  createdAt?: string;
}

export interface AuditLogItem {
  id?: string;
  action: string;
  actor: string;
  target?: string;
  details?: any;
  timestamp: any;
}

export const CLIENT_STATUS = { PENDING: 'pending_approval', APPROVED: 'approved', REJECTED: 'rejected' } as const;
export const PROJECT_STATUS = {
  NOT_STARTED: 'not_started',
  IN_PROGRESS: 'in_progress',
  REQUIRED_DATA_PENDING: 'required_data_pending',
  IN_REVISION: 'in_revision',
  IN_VERIFICATION: 'in_verification',
  DELAYED: 'delayed',
  COMPLETED: 'completed'
} as const;

export const CLIENT_FIELDS = {
  COMPANY_NAME: 'companyName', CONTACT_PERSON: 'contactPerson', EMAIL: 'email', CLIENT_EMAIL: 'clientEmail',
  PHONE: 'phone', CONTACT_NUMBER: 'contactNumber',
  CITY: 'city', GSTIN: 'gstin', BILLING_ADDRESS: 'billingAddress', PRICING_CATEGORY: 'pricingCategory', SALES_PERSON_EMAIL: 'salesPersonEmail',
  PROPOSAL_NUMBER: 'proposalNumber', STATUS: 'status', CREATED_AT: 'createdAt'
} as const;

export const PROJECT_FIELDS = {
  PROJECT_NAME: 'projectName',
  PROJECT_NUMBER: 'projectNumber', CLIENT_ID: 'clientId', CLIENT_NAME: 'clientName',
  SCOPE_OF_WORK: 'scopeOfWork', SUB_SERVICE: 'subService', PLANT_CAPACITY: 'plantCapacity',
  CAPACITY_UNIT: 'capacityUnit', LOCATION: 'location', DESIGNER_EMAIL: 'designerEmail',
  PRICING_CATEGORY: 'pricingCategory', STATUS: 'status', CREATED_AT: 'createdAt', UPDATED_AT: 'updatedAt',
  MODULES: 'modules',
  ASSIGNED_SCOPES: 'assignedScopes',
  DATE: 'date'
} as const;

export interface ProjectRecord {
  id?: string;
  projectName: string;
  projectNumber: string;
  srNumber?: string;
  date?: string;
  projectDate?: string;
  clientId: string;
  clientName: string;
  scopeOfWork: string;
  subService?: string | null;
  plantCapacity?: number | null;
  capacityUnit?: string;
  location: string;
  designerEmail: string;
  designerName?: string;
  assignedScopes?: Record<string, string>; // Maps scope key (e.g. preDesign, pvsyst) to designer email
  modules?: ProjectModulePhase[];
  pricingCategory?: string;
  status: string;
  remarks?: string | null;
  salesPersonEmail: string;
  salesPersonName?: string;
  projectValue?: number | null;
  createdAt?: any;
  updatedAt?: any;
}

export interface ProjectModulePhase {
  phaseKey: 'preDesign' | 'ceig' | 'ifp' | string;
  phaseName: string;
  status: 'not_started' | 'in_progress' | 'completed' | string;
  assignedDesignerEmail?: string;
  assignedDesignerName?: string;
  startedAt?: any;
  completedAt?: any;
  notes?: string;
}

export interface HistoricalPaymentLedgerRecord {
  id?: string;
  clientEmail: string;
  clientId: string;
  invoiceNumber: string;
  amount: number;
  currency: string;
  paidAt: any;
  status: 'paid' | 'credited' | 'partially_credited';
  phaseCredited?: string;
  creditVoucherId?: string;
  createdAt: any;
}

