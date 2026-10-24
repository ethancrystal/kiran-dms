-- =============================================================================
-- Kiran DMS · migration 0003 · Configuration defaults (task P0-08, ADM-01)
-- Every value is a planning default from docs 02, 04, 09, 10 and is marked
-- [default-unconfirmed] until MJ / the owner confirms it (A-01, B-05, OQ-06, OQ-07).
-- Owner changes them with app.owner_set_config (owner-only, AAL2, audited); a change
-- clears the note. Inserts never overwrite a value the owner has already set.
-- Amounts are integer paisa (Rs 1 = 100 paisa).
-- =============================================================================

insert into public.app_config (key, value, rep_visible, note) values
  -- doc 09 §1 — installment plan templates (PAY-01). day_offset 0 = delivery day.
  ('plan.templates', '[
     {"code": "CASH", "name": "Cash on delivery", "schedule": [{"pct": 100, "day_offset": 0}]},
     {"code": "INST2", "name": "Two installments", "schedule": [{"pct": 50, "day_offset": 0}, {"pct": 50, "day_offset": 15}]},
     {"code": "INST4", "name": "Four installments", "schedule": [{"pct": 25, "day_offset": 0}, {"pct": 25, "day_offset": 10}, {"pct": 25, "day_offset": 20}, {"pct": 25, "day_offset": 30}]}
   ]'::jsonb, true,
   '[default-unconfirmed] doc 09 §1; OQ-06 asks whether plans take 0% at delivery'),

  -- doc 09 §2 — credit rules (PAY-09, CTL-09)
  ('credit.rules', '{
     "unverified_salon_plan": "CASH",
     "first_order_plan": "INST2",
     "starting_limit_paisa": {
       "ladies_parlor": 1500000, "bridal_studio": 1500000, "unisex": 1500000, "hair_studio": 1500000,
       "spa_wellness": 1500000, "academy": 1500000, "home_parlor": 800000,
       "mens_salon": 800000, "barber": 800000, "other": 800000
     },
     "ceiling_paisa": null,
     "on_time_within_days": 3,
     "graduate_to_inst4_after_on_time_cycles": 3,
     "auto_increase_pct": 25,
     "auto_increase_every_on_time_cycles": 3,
     "auto_decrease_pct": 30,
     "auto_decrease_when_late_days_over": 7,
     "eligibility_drop_after_late_installments": 2,
     "eligibility_drop_window_days": 60,
     "block_when_overdue_days_over": 30
   }'::jsonb, false,
   '[default-unconfirmed] doc 09 §2; doc names ladies/bridal Rs 15,000 and men''s/barber Rs 8,000 only, other types assumed (A-05); ceiling unset until OQ-07'),

  -- doc 09 §7 / doc 02 — overdue escalation ladder (PAY-08)
  ('collections.escalation_days', '{
     "reminder": -2, "collection_stop": 0, "red_flag": 3, "manager_call": 7,
     "installments_blocked": 15, "salon_blocked": 30, "write_off_review": 60
   }'::jsonb, false,
   '[default-unconfirmed] doc 09 §7'),

  -- doc 10 §1 — product groups and default re-order cycles (PIP-05)
  ('catalogue.product_groups', '[
     {"code": "color", "name": "Color", "default_cycle_days": 21},
     {"code": "developer", "name": "Developer", "default_cycle_days": 21},
     {"code": "shampoo", "name": "Shampoo & conditioner", "default_cycle_days": 30},
     {"code": "treatment", "name": "Treatment & masks", "default_cycle_days": 30},
     {"code": "styling", "name": "Styling", "default_cycle_days": 45},
     {"code": "consumables", "name": "Salon consumables", "default_cycle_days": 30}
   ]'::jsonb, true,
   '[default-unconfirmed] doc 10 §1; consumables cycle not in docs, 30 assumed (A-05). Product names stay [Dummy] until OQ-16'),

  -- doc 04 visit.outcome + doc 02 Trial stage (PIP-02, PIP-10)
  ('visit.outcomes', '[
     {"code": "order", "en": "Order taken", "ur": "آرڈر لیا"},
     {"code": "collection", "en": "Payment collected", "ur": "وصولی"},
     {"code": "sample", "en": "Sample given", "ur": "نمونہ دیا"},
     {"code": "quote", "en": "Quote / trial pack offered", "ur": "قیمت بتائی"},
     {"code": "intro", "en": "Introduction", "ur": "تعارف"},
     {"code": "no_decision", "en": "No decision", "ur": "فیصلہ نہیں ہوا"},
     {"code": "closed_not_interested", "en": "Not interested", "ur": "دلچسپی نہیں"},
     {"code": "not_present", "en": "Owner not present", "ur": "مالک موجود نہیں"}
   ]'::jsonb, true,
   '[default-unconfirmed] doc 04 visit.outcome plus "quote" from doc 02 Trial stage (A-05)'),

  -- doc 03 SAL-01 — salon types
  ('salon.types', '["ladies_parlor", "mens_salon", "unisex", "bridal_studio", "barber", "hair_studio", "spa_wellness", "home_parlor", "academy", "other"]'::jsonb, true,
   '[default-unconfirmed] SAL-01 / doc 04'),

  -- doc 02 — pipeline timers (PIP-06)
  ('pipeline.timers', '{
     "reorder_task_days_before_due": 3,
     "at_risk_after_cycle_overdue_pct": 50,
     "new_to_at_risk_days_without_second_order": 60,
     "dormant_after_days": 90,
     "trial_to_parked_after_visits": 3,
     "parked_resurface_days": 90
   }'::jsonb, false,
   '[default-unconfirmed] doc 02 stages'),

  -- doc 05 / MAP-04 — nearby discovery radius
  ('map.discovery_radius_m', '{"default": 3000, "max": 6000}'::jsonb, true,
   '[default-unconfirmed] MAP-04')
on conflict (key) do nothing;
