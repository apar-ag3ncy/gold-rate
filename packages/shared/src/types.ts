export const ROLES = ['admin', 'staff', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export const RATE_STATUSES = ['draft', 'approved', 'sent', 'cancelled'] as const;
export type RateStatus = (typeof RATE_STATUSES)[number];

export interface RateDTO {
  id: string;
  date: string;
  unit: 'per_gram';
  k24: number; k22: number; k18: number;
  extraPurities: { label: string; value: number }[];
  status: RateStatus;
  enteredBy?: string; approvedBy?: string; approvedAt?: string;
  overrideReason?: string;
  validation: { errors: string[]; warnings: string[] };
  createdAt: string; updatedAt: string;
}
