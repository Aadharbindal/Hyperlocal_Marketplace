import type { CategoryRecord, SkillRecord } from './types';

// Mirrors the seed rows in supabase/migrations/0001_foundation.sql (same UUIDs).
const C = (n: string) => `11111111-1111-4111-8111-1111111111${n}`;
const S = (n: string) => `22222222-2222-4222-8222-2222222222${n}`;

export const CATEGORY_SEED: CategoryRecord[] = [
  { id: C('01'), slug: 'plumbing', name_en: 'Plumbing', name_hi: 'प्लंबिंग', icon_key: 'plumbing', is_enabled: true, requires_inspection_default: false, sort_order: 10 },
  { id: C('02'), slug: 'electrical', name_en: 'Electrical', name_hi: 'इलेक्ट्रिकल', icon_key: 'electrical', is_enabled: true, requires_inspection_default: false, sort_order: 20 },
  { id: C('03'), slug: 'carpentry', name_en: 'Carpentry', name_hi: 'बढ़ईगीरी', icon_key: 'carpentry', is_enabled: true, requires_inspection_default: false, sort_order: 30 },
  { id: C('04'), slug: 'appliance-repair', name_en: 'Appliance Repair', name_hi: 'उपकरण मरम्मत', icon_key: 'appliance', is_enabled: false, requires_inspection_default: true, sort_order: 40 },
];

export const SKILL_SEED: SkillRecord[] = [
  { id: S('01'), category_id: C('01'), slug: 'tap-leak', name_en: 'Tap and leak repair', name_hi: 'नल और लीक की मरम्मत', risk_level: 'LOW' },
  { id: S('02'), category_id: C('01'), slug: 'drain-block', name_en: 'Blocked drain', name_hi: 'नाली जाम', risk_level: 'LOW' },
  { id: S('03'), category_id: C('01'), slug: 'water-heater', name_en: 'Water heater / geyser', name_hi: 'गीज़र', risk_level: 'MEDIUM' },
  { id: S('04'), category_id: C('01'), slug: 'bathroom-fitting', name_en: 'Bathroom fittings', name_hi: 'बाथरूम फ़िटिंग', risk_level: 'MEDIUM' },
  { id: S('11'), category_id: C('02'), slug: 'switch-socket', name_en: 'Switch and socket', name_hi: 'स्विच और सॉकेट', risk_level: 'LOW' },
  { id: S('12'), category_id: C('02'), slug: 'fan-light', name_en: 'Fan and light installation', name_hi: 'पंखा और लाइट', risk_level: 'LOW' },
  { id: S('13'), category_id: C('02'), slug: 'wiring', name_en: 'Wiring and MCB', name_hi: 'वायरिंग और MCB', risk_level: 'HIGH' },
  { id: S('14'), category_id: C('02'), slug: 'inverter', name_en: 'Inverter and UPS', name_hi: 'इन्वर्टर', risk_level: 'MEDIUM' },
  { id: S('21'), category_id: C('03'), slug: 'furniture-repair', name_en: 'Furniture repair', name_hi: 'फ़र्नीचर मरम्मत', risk_level: 'LOW' },
  { id: S('22'), category_id: C('03'), slug: 'door-window', name_en: 'Door and window', name_hi: 'दरवाज़ा और खिड़की', risk_level: 'MEDIUM' },
  { id: S('23'), category_id: C('03'), slug: 'modular-fitting', name_en: 'Modular fitting', name_hi: 'मॉड्यूलर फ़िटिंग', risk_level: 'MEDIUM' },
  { id: S('31'), category_id: C('04'), slug: 'washing-machine', name_en: 'Washing machine', name_hi: 'वॉशिंग मशीन', risk_level: 'MEDIUM' },
  { id: S('32'), category_id: C('04'), slug: 'refrigerator', name_en: 'Refrigerator', name_hi: 'फ़्रिज', risk_level: 'MEDIUM' },
];
