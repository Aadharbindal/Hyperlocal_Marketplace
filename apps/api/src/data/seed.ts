import { geohash, type UserRole } from '@hyperlocal/core';
import { CATEGORY_SEED, SKILL_SEED } from './catalog';
import type { Env } from '../config/env';
import type { DataStore } from './types';

/**
 * Demo accounts for local/demo mode. Log in with the phone number and OTP `OTP_DEMO_CODE`
 * (default 123456) while SMS_PROVIDER=mock. Never run against production.
 */
export const DEMO_ACCOUNTS = [
  { phone: '+919000000001', name: 'Ramesh Kumar', roles: ['CUSTOMER'] as UserRole[] },
  { phone: '+919000000002', name: 'Suresh Plumbing Works', roles: ['PROVIDER'] as UserRole[] },
  { phone: '+919000000003', name: 'Anita Electricals', roles: ['PROVIDER', 'CUSTOMER'] as UserRole[] },
  { phone: '+919000000004', name: 'BuildRight Services', roles: ['CONTRACTOR'] as UserRole[] },
  { phone: '+919000000005', name: 'Ravi (Technician)', roles: ['TECHNICIAN'] as UserRole[] },
  { phone: '+919000000006', name: 'Sharma Hardware', roles: ['VENDOR'] as UserRole[] },
  { phone: '+919000000007', name: 'Platform Admin', roles: ['ADMIN'] as UserRole[] },
  { phone: '+919000000008', name: 'Support Agent', roles: ['SUPPORT'] as UserRole[] },
];

export async function seedDemo(store: DataStore, env: Env): Promise<void> {
  if (env.APP_ENV === 'production') throw new Error('Refusing to seed demo data in production');
  for (const acc of DEMO_ACCOUNTS) {
    let user = await store.users.findByPhone(acc.phone);
    if (!user) {
      user = await store.users.create({ phone_e164: acc.phone, display_name: acc.name });
      await store.users.update(user.id, { phone_verified_at: new Date() });
    }
    const existing = new Set((await store.users.listRoles(user.id)).map((r) => r.role));
    for (const role of acc.roles) if (!existing.has(role)) await store.users.grantRole({ user_id: user.id, role, granted_by: null });

    if (acc.roles.includes('CUSTOMER') && !(await store.users.getCustomerProfile(user.id))) {
      await store.users.upsertCustomerProfile({ user_id: user.id, full_name: acc.name, email: null, default_address_id: null, marketing_opt_in: false });
      const lat = env.PILOT_CENTER_LAT + 0.004;
      const lng = env.PILOT_CENTER_LNG - 0.003;
      const addr = await store.addresses.create({
        user_id: user.id,
        label: 'Home',
        line1: 'B-42, Green Park Society',
        line2: null,
        landmark: 'Near community hall',
        society_name: 'Green Park Society',
        gate_instructions: 'Gate 2, tell the guard flat B-42',
        city: env.PILOT_CITY,
        pincode: '110016',
        lat,
        lng,
        geohash: geohash({ lat, lng }),
        is_default: true,
        in_pilot_zone: true,
        deleted_at: null,
      });
      await store.users.upsertCustomerProfile({ user_id: user.id, full_name: acc.name, email: null, default_address_id: addr.id, marketing_opt_in: false });
    }
    if (acc.roles.includes('PROVIDER') && !(await store.users.getProviderProfile(user.id))) {
      // Demo providers are verified and skilled so the nearby feed works out of the box.
      const demoCategories = CATEGORY_SEED.filter((c) => c.is_enabled).map((c) => c.id);
      await store.users.setProviderSkills(user.id, SKILL_SEED.filter((s2) => demoCategories.includes(s2.category_id)).map((s2) => s2.id));
      await store.users.upsertProviderProfile({
        user_id: user.id,
        business_name: acc.name,
        bio: 'Verified local professional (demo).',
        experience_years: 8,
        service_radius_km: 3,
        base_lat: env.PILOT_CENTER_LAT,
        base_lng: env.PILOT_CENTER_LNG,
        is_available: true,
        verification_status: 'VERIFIED',
        reliability_score: 4.8,
        rating_avg: 4.7,
        rating_count: 42,
        completed_jobs: 120,
        strike_count: 0,
        contractor_id: null,
        suspended_until: null,
      });
    }
    if (acc.roles.includes('TECHNICIAN') && !(await store.users.getTechnicianProfile(user.id))) {
      // Ravi works for the demo plumbing provider, so the technician handoff is demoable.
      const employer = await store.users.findByPhone('+919000000002');
      await store.users.upsertTechnicianProfile({
        user_id: user.id,
        contractor_id: employer?.id ?? user.id,
        full_name: acc.name,
        verification_status: 'VERIFIED',
        skills: [],
        active: true,
      });
    }
    if (acc.roles.includes('CONTRACTOR') && !(await store.users.getContractorProfile(user.id))) {
      await store.users.upsertContractorProfile({
        user_id: user.id,
        business_name: acc.name,
        verification_status: 'VERIFIED',
        base_lat: env.PILOT_CENTER_LAT,
        base_lng: env.PILOT_CENTER_LNG,
        service_radius_km: 5,
      });
    }
    if (acc.roles.includes('VENDOR') && !(await store.users.getVendorProfile(user.id))) {
      await store.users.upsertVendorProfile({
        user_id: user.id,
        shop_name: acc.name,
        shop_address_id: null,
        delivery_radius_km: 3,
        material_categories: ['plumbing', 'electrical'],
        delivery_available: true,
        verification_status: 'VERIFIED',
      });
    }
  }
}
