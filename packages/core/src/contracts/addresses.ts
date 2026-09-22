import { z } from 'zod';

export const AddressCreate = z
  .object({
    label: z.string().trim().min(1).max(30).default('Home'),
    line1: z.string().trim().min(3).max(120),
    line2: z.string().trim().max(120).optional(),
    landmark: z.string().trim().max(120).optional(),
    societyName: z.string().trim().max(80).optional(),
    gateInstructions: z.string().trim().max(240).optional(),
    city: z.string().trim().min(2).max(60),
    pincode: z.string().regex(/^\d{6}$/, 'Enter a 6-digit PIN code'),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    isDefault: z.boolean().optional(),
  })
  .strict();
export type AddressCreate = z.infer<typeof AddressCreate>;

export const AddressUpdate = AddressCreate.partial();
export type AddressUpdate = z.infer<typeof AddressUpdate>;

export const AddressView = z.object({
  id: z.string().uuid(),
  label: z.string(),
  line1: z.string(),
  line2: z.string().nullable(),
  landmark: z.string().nullable(),
  societyName: z.string().nullable(),
  gateInstructions: z.string().nullable(),
  city: z.string(),
  pincode: z.string(),
  lat: z.number(),
  lng: z.number(),
  isDefault: z.boolean(),
  inPilotZone: z.boolean(),
  createdAt: z.string(),
});
export type AddressView = z.infer<typeof AddressView>;
