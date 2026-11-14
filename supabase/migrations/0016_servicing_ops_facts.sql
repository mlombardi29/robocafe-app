-- Successor servicing ops facts. Additive. Does not rewrite existing visit snapshots.
-- Provenance: frozen client 41a495d + immutable 0015_servicing_feedback.sql remain historical.
-- Apply path for live DB currently on 0010: load this file alone (includes Not needed stamp + save_completion from 0015 scope).
-- Do not apply 0011-0014 with this file. Do not rewrite 0015.
-- Hosted apply requires separate approval. Kiosoft milk entry: actual added minus 500 mL (manual instruction only).

update public.checklist_items i
set title = 'Sign in to KC Manager: scan your QR code at the kiosk'
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'kc_sign_in' and m.code = 's35';

update public.checklist_items i
set title = 'Wash hands, put on gloves'
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'gloves' and m.code = 's35';

update public.checklist_items i
set title = 'Robot arm calibration',
    details = $txt$1. On the order tablet go to Robot API.
2. Press Get Weight. It should read 0 g.
3. Press Close Claw and place the weighing cup from the top into the claw.
4. Press Get Weight. 190–210 g inclusive is successful.
5. Remove the weighing cup. Open the claw using the button.
6. If the weight is outside that range, still remove the cup and open the claw, then press Auto Calibrate. The robot picks up the cup itself.
7. When it does, read the displayed weight. It should say 200 and success.

Additional info
Do not press a manual Calibrate 200 command. This weight check is not the cup presence sensor.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'arm_calibration' and m.code = 's35';

update public.checklist_items i
set title = 'Arm sensor check',
    details = $txt$1. In the Robot API, move the arm to single hot cup. Look at the arm sensor light.
2. Move the arm to single cold cup. Look at the light again.
3. Both times it should be solid green. If it is, you are done.
4. If not, very gently wipe the shiny reflective surface only, then check again.

Additional info
Mount Sinai only. Even a tiny bump can knock the sensor out of line. Wipe softly. Note it if cleaning was needed. This is not the robot arm weight / Auto Calibrate check.$txt$,
    status = 'active'
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'arm_sensor' and m.code = 's35';

update public.checklist_items i
set title = 'Put the kiosk in maintenance mode',
    details = $txt$1. Scan in with the KCM app. The options appear after that scan.
2. On the order pickup tablet, press Maintenance Mode.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'maintenance_mode' and m.code = 's35';

update public.checklist_items i
set title = 'Fill beans',
    details = $txt$Minimum two-thirds full. If below two-thirds, refill. If at or above two-thirds, leave alone. Exactly two-thirds is not below, so do not refill.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'fill_beans' and m.code = 's35';

update public.checklist_items i
set title = 'Empty pucks, if needed',
    details = $txt$Empty it by volume, or whenever it has been 2 days or more since it was last emptied.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'empty_pucks' and m.code = 's35';

update public.checklist_items i
set title = 'Add cleaning balls, if needed (at least 7, none cracked)',
    details = $txt$If you need to remove any balls that are cracked, do so, or else it will damage the machine.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'cleaning_balls' and m.code = 's35';

update public.checklist_items i
set title = 'Long Water Pour',
    details = $txt$1. Scroll through the product pages on the Cameo. You may need to press Next a few times.
2. Select the Long Water Pour.
3. With a container underneath the Cameo nozzle, this water will be used for the syrup cleaning. You may need to dispense it twice.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'long_water' and m.code = 's35';

update public.checklist_items i
set title = 'Start milk cleaning',
    details = $txt$1. Cameo menu, top middle, Clean.
2. Follow the prompts on the screen.
3. Use a container with 30 mL of EverClean (not Rinza) when the Cameo asks for cleaner.

Additional info
The cleaning runs about 11 minutes. EverClean is required here — do not use blue Rinza for this Cameo milk clean.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'start_milk_clean' and m.code = 's35';

update public.checklist_items i
set title = 'Change the milk bag if it is due',
    details = $txt$No milk stays in a bag more than 4 days. Don't touch the tubes. During cleaning the tubes are in the hot water and EverClean container (30 mL EverClean, not Rinza), so you can change the bag.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'milk_bag' and m.code = 's35';

update public.checklist_items i
set title = 'Top up 2% and oat',
    details = $txt$Don't touch the tubes.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'milk_topup' and m.code = 's35';

update public.checklist_items i
set title = 'Syrup cleaning and top-ups',
    details = $txt$1. Open the syrup drawer.
2. Press Clean.
3. Follow the prompts on the syrup containers.
4. At the final tube refill, when syrup is visible from all spouts, press OK so it does not keep pouring.
5. Wipe the bottles with hot water.
6. Push the nozzles at the end of the tubes fully down so they reach deep into the liquid, not just the surface.
7. Caps tight on top.
8. Run a pipe cleaner through the syrup nozzles so they don't clog.

Additional info
At UofT (2.2), move the cup holder out of the way. At Sinai (3.5) and RBC (S5), park the robotic arm out of the way.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'syrup' and m.code = 's35';

update public.checklist_items i
set title = 'Clean the powder nozzles',
    details = $txt$1. Lay a damp paper towel under the dispenser first to catch fallout.
2. Turn the nozzles upward and take out the funnels.
3. Check for powder buildup or residue. If there is residue, deep clean it, and it must be completely dry before you put it back. Wetness causes more buildup.
4. Vacuum any loose powder with the handheld vacuum.
5. Turn all three powder spouts back to down-facing, or powder drinks come out as plain hot water.

Additional info
Powdered matcha is not in use right now — do not spend time servicing an unused matcha container. Do not delete history for past matcha rows.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'powder_clean' and m.code = 's35';

update public.checklist_items i
set title = 'Powders',
    details = $txt$Fill only if below half. Matcha is unused — leave that container alone.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'powder_fill' and m.code = 's35';

update public.checklist_items i
set title = 'Cups and lids',
    details = $txt$Gently twist stuck 16 oz cold cups apart before loading, then seat them lightly in the cup holder. Otherwise they jam at the top and won't dispense.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'cups_lids' and m.code = 's35';

update public.checklist_items i
set title = 'Cup and drink garbage',
    details = $txt$Quick look. Empty it only if it is worth it.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'garbage' and m.code = 's35';

update public.checklist_items i
set title = 'Clean Robot Claw (delicately)',
    details = $txt$1. The arm and claw are very sensitive to pressure and easy to knock off calibration.
2. Use very hot water on a towel and press lightly.
3. Don't scrub and don't push.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'claw' and m.code = 's35';

update public.checklist_items i
set title = 'Glass and surfaces',
    details = $txt$If splashes or marks would make you not want to buy from it, wipe it.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'glass' and m.code = 's35';

update public.checklist_items i
set title = 'Wipe the Cameo',
    details = $txt$If splashes or marks would make you not want to buy from it, wipe it.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'wipe_cameo' and m.code = 's35';

update public.checklist_items i
set title = 'Close-up check',
    details = $txt$1. The drink dispensing elevators sit higher when the kiosk is running than when they are open for servicing.
2. They slide down to the customer opening, and there is less space at the top.
3. Leave clear space above anything you put back, and do not stack anything into that path.
4. A blocked elevator takes the kiosk out of service and can break it.

Additional info
Other doors on the kiosk are separate. Do not block those either.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'door_check' and m.code = 's35';

update public.checklist_items i
set title = 'Update consumables in KC Manager',
    details = $txt$Enter what you filled. Confirm updates in command history.

Additional info
For milk in the Kiosoft consumables app only: enter the actual amount added minus 500 mL (example: add 8,000 mL → enter 7,500 mL). This does not change how much milk you actually add, and it does not change KioskOps inventory or rewrite history. Do not use the old 1,000–1,500 mL under-report text.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'kc_consumables' and m.code = 's35';

update public.checklist_items i
set title = 'Exit maintenance mode'
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'exit_maint' and m.code = 's35';

update public.checklist_items i
set title = 'Test drink',
    details = $txt$Have a test drink, whatever you want. You can also offer it to someone nearby. If you're unsure a drink will make properly, test that one.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'test_drink' and m.code = 's35';

update public.checklist_items i
set title = 'Deep clean milk nozzles'
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'deep_clean_nozzles' and m.code = 's35';

update public.checklist_items i
set title = 'Deep clean fridges'
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'deep_clean_fridges' and m.code = 's35';

update public.checklist_items i
set title = 'Sign in to KC Manager: scan your QR code at the kiosk'
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'kc_sign_in' and m.code = 's22';

update public.checklist_items i
set title = 'Wash hands, put on gloves'
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'gloves' and m.code = 's22';

update public.checklist_items i
set title = 'Scale calibration check',
    details = $txt$1. Set your separate (independent) scale to 0 g. Fill a cup with water until it weighs 200 g on that scale.
2. At the kiosk, make sure nothing is on the scale.
3. Open the Scale API and press Reset the scale to 0.
4. Put the 200 g cup of water on the scale.
5. Press Get Weight.
6. If it reads between 190 g and 210 g inclusive, the scale is fine.
7. If not, press Calibrate to 200g.
8. Press Get Weight. It should read 200 g.
9. If it still will not read 200 g, post in the WhatsApp channel.

Additional info
Do this every visit, before maintenance mode when practical. Maintenance Mode is its own checklist step. This is the UofT drink/ice scale — not the Sinai/RBC robot arm Auto Calibrate weight check.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'scale_check' and m.code = 's22';

update public.checklist_items i
set title = 'Put the kiosk in maintenance mode',
    details = $txt$1. Scan in with the KCM app. The options appear after that scan.
2. On the order pickup tablet, press Maintenance Mode.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'maintenance_mode' and m.code = 's22';

update public.checklist_items i
set title = 'Start milk module cleaning',
    details = $txt$1. Press Clean on the milk frother and follow the prompts.
2. Fill the water pitcher with 750 mL of water and 30 mL of blue Rinza.
3. When the frother tells you to, take the tubes out of the milk and put them in the water.
4. Keep the fridge door shut.

Additional info
The cleaning runs about 9 minutes. Don't touch the module while it runs. UofT uses Rinza here — not EverClean.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'start_milk_clean' and m.code = 's22';

update public.checklist_items i
set title = 'Change the milk bag if it is due',
    details = $txt$No milk stays in a bag more than 4 days. Don't touch the tubes while they are in the cleaning pitcher. When you put the tubes back in the milk, the suction tube must sit 1 inch lower than the sensor tube.

Additional info
UofT has one milk, 2%. An uncovered pitcher or an open fridge door during cleaning lets steam freeze inside the fridge.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'milk_bag' and m.code = 's22';

update public.checklist_items i
set title = 'Top up 2% milk',
    details = $txt$This kiosk uses 2% only. Don't touch the tubes.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'milk_topup' and m.code = 's22';

update public.checklist_items i
set title = 'Coffee concentrate',
    details = $txt$Minimum two-thirds full. If below two-thirds, refill. If at or above two-thirds, leave alone.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'concentrate' and m.code = 's22';

update public.checklist_items i
set title = 'Syrup cleaning and top-ups',
    details = $txt$1. Open the syrup drawer.
2. Press Clean.
3. Follow the prompts on the syrup containers.
4. At the final tube refill, when syrup is visible from all spouts, press OK so it does not keep pouring.
5. Wipe the bottles with hot water.
6. Push the nozzles at the end of the tubes fully down so they reach deep into the liquid, not just the surface.
7. Caps tight on top.
8. Run a pipe cleaner through the syrup nozzles so they don't clog.

Additional info
At UofT (2.2), move the cup holder out of the way. At Sinai (3.5) and RBC (S5), park the robotic arm out of the way.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'syrup' and m.code = 's22';

update public.checklist_items i
set title = 'Clean the powder nozzles',
    details = $txt$1. Lay a damp paper towel under the dispenser first to catch fallout.
2. Turn the nozzles upward and take out the funnels.
3. Check for powder buildup or residue. If there is residue, deep clean it, and it must be completely dry before you put it back. Wetness causes more buildup.
4. Vacuum any loose powder with the handheld vacuum.
5. Turn all three powder spouts back to down-facing, or powder drinks come out as plain hot water.

Additional info
Powdered matcha is not in use right now — do not spend time servicing an unused matcha container. Do not delete history for past matcha rows.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'powder_clean' and m.code = 's22';

update public.checklist_items i
set title = 'Powders',
    details = $txt$Fill only if below half. Matcha is unused — leave that container alone.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'powder_fill' and m.code = 's22';

update public.checklist_items i
set title = 'Cups and lids',
    details = $txt$Gently twist stuck 16 oz cold cups apart before loading, then seat them lightly in the cup holder. Otherwise they jam at the top and won't dispense.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'cups_lids' and m.code = 's22';

update public.checklist_items i
set title = 'Cup and drink garbage',
    details = $txt$Quick look. Empty it only if it is worth it.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'garbage' and m.code = 's22';

update public.checklist_items i
set title = 'Glass and surfaces',
    details = $txt$If splashes or marks would make you not want to buy from it, wipe it.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'glass' and m.code = 's22';

update public.checklist_items i
set title = 'Update consumables in KC Manager',
    details = $txt$Enter what you filled: milk, syrups, powders, cups, lids and coffee concentrate. Confirm updates in command history.

Additional info
For milk in the Kiosoft consumables app only: enter the actual amount added minus 500 mL (example: add 8,000 mL → enter 7,500 mL). This does not change how much milk you actually add, and it does not change KioskOps inventory or rewrite history. Do not use the old 1,000–1,500 mL under-report text.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'kc_consumables' and m.code = 's22';

update public.checklist_items i
set title = 'Exit maintenance mode'
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'exit_maint' and m.code = 's22';

update public.checklist_items i
set title = 'Test drink',
    details = $txt$Order a milk-based test drink (like a latte) so the frother runs its self-rinse. Check it comes out correctly.

Additional info
The drink must include milk. App-credit payment policy is not newly required by this update.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'test_drink' and m.code = 's22';

update public.checklist_items i
set title = 'Deep clean milk nozzles'
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'deep_clean_nozzles' and m.code = 's22';

update public.checklist_items i
set title = 'Deep clean fridges'
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'deep_clean_fridges' and m.code = 's22';

update public.checklist_items i
set title = 'Sign in to KC Manager: scan your QR code at the kiosk'
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'kc_sign_in' and m.code = 's5';

update public.checklist_items i
set title = 'Wash hands, put on gloves'
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'gloves' and m.code = 's5';

update public.checklist_items i
set title = 'Robot arm calibration',
    details = $txt$1. On the order tablet go to Robot API.
2. Press Get Weight. It should read 0 g.
3. Press Close Claw and place the weighing cup from the top into the claw.
4. Press Get Weight. 190–210 g inclusive is successful.
5. Remove the weighing cup. Open the claw using the button.
6. If the weight is outside that range, still remove the cup and open the claw, then press Auto Calibrate. The robot picks up the cup itself.
7. When it does, read the displayed weight. It should say 200 and success.

Additional info
Do not press a manual Calibrate 200 command. This weight check is not the cup presence sensor.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'arm_calibration' and m.code = 's5';

update public.checklist_items i
set title = 'Arm sensor check',
    details = $txt$This arm sensor solid-green check is for Mount Sinai only. At RBC, mark Not needed.

Additional info
Do not invent Sinai sensor criteria at RBC. Robot arm weight / Auto Calibrate remains the weekly weight check on this model.$txt$,
    status = 'active'
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'arm_sensor' and m.code = 's5';

update public.checklist_items i
set title = 'Put the kiosk in maintenance mode',
    details = $txt$1. Scan in with the KCM app. The options appear after that scan.
2. On the order pickup tablet, press Maintenance Mode.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'maintenance_mode' and m.code = 's5';

update public.checklist_items i
set title = 'Fill beans',
    details = $txt$Minimum two-thirds full. If below two-thirds, refill. If at or above two-thirds, leave alone. Exactly two-thirds is not below, so do not refill.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'fill_beans' and m.code = 's5';

update public.checklist_items i
set title = 'Empty pucks, if needed',
    details = $txt$Empty it by volume, or whenever it has been 2 days or more since it was last emptied. This follows days since it was emptied, not each show.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'empty_pucks' and m.code = 's5';

update public.checklist_items i
set title = 'Add cleaning balls, if needed (at least 7, none cracked)',
    details = $txt$If you need to remove any balls that are cracked, do so, or else it will damage the machine.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'cleaning_balls' and m.code = 's5';

update public.checklist_items i
set title = 'Long Water Pour',
    details = $txt$1. Scroll through the product pages on the Cameo. You may need to press Next a few times.
2. Select the Long Water Pour.
3. With a container underneath the Cameo nozzle, this water will be used for the syrup cleaning. You may need to dispense it twice.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'long_water' and m.code = 's5';

update public.checklist_items i
set title = 'Start milk cleaning',
    details = $txt$1. Cameo menu, top middle, Clean.
2. Follow the prompts on the screen.
3. Use a container with 30 mL of EverClean (not Rinza) when the Cameo asks for cleaner.

Additional info
The cleaning runs about 18 minutes. EverClean is required here — do not use blue Rinza for this Cameo milk clean.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'start_milk_clean' and m.code = 's5';

update public.checklist_items i
set title = 'Change the milk bag if it is due',
    details = $txt$No milk stays in a bag more than 4 days. Count days since the fresh bag, not shows. Don't touch the tubes. During cleaning the tubes are in the hot water and EverClean container (30 mL EverClean, not Rinza), so you can change the bag.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'milk_bag' and m.code = 's5';

update public.checklist_items i
set title = 'Top up 2% and oat',
    details = $txt$Don't touch the tubes.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'milk_topup' and m.code = 's5';

update public.checklist_items i
set title = 'Grey water',
    details = $txt$RBC / PRACTICE RBC only. Grey water collects in a container underneath the kiosk with a coiled hose (not a fixed direct drain into plumbing).
1. Uncoil the hose and position the end near the ground drain.
2. Turn the handle/clasp so the container drains through the hose into that drain.
3. Turn the clasp back to perpendicular (closed) BEFORE you bring the hose in, and coil the hose back up.

Additional info
If the clasp stays open, the next drink's grey water floods inside the kiosk.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'grey_water' and m.code = 's5';

update public.checklist_items i
set title = 'Syrup cleaning and top-ups',
    details = $txt$1. Open the syrup drawer.
2. Press Clean.
3. Follow the prompts on the syrup containers.
4. At the final tube refill, when syrup is visible from all spouts, press OK so it does not keep pouring.
5. Wipe the bottles with hot water.
6. Push the nozzles at the end of the tubes fully down so they reach deep into the liquid, not just the surface.
7. Caps tight on top.
8. Run a pipe cleaner through the syrup nozzles so they don't clog.

Additional info
At UofT (2.2), move the cup holder out of the way. At Sinai (3.5) and RBC (S5), park the robotic arm out of the way.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'syrup' and m.code = 's5';

update public.checklist_items i
set title = 'Clean the powder nozzles',
    details = $txt$1. Lay a damp paper towel under the dispenser first to catch fallout.
2. Turn the nozzles upward and take out the funnels.
3. Check for powder buildup or residue. If there is residue, deep clean it, and it must be completely dry before you put it back. Wetness causes more buildup.
4. Vacuum any loose powder with the handheld vacuum.
5. Turn all three powder spouts back to down-facing, or powder drinks come out as plain hot water.

Additional info
Powdered matcha is not in use right now — do not spend time servicing an unused matcha container. Do not delete history for past matcha rows.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'powder_clean' and m.code = 's5';

update public.checklist_items i
set title = 'Powders',
    details = $txt$Fill only if below half. Matcha is unused — leave that container alone.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'powder_fill' and m.code = 's5';

update public.checklist_items i
set title = 'Cups and lids',
    details = $txt$Fill cups and lids to the top. Gently twist stuck 16 oz cold cups apart before loading, then seat them lightly in the cup holder. Otherwise they jam at the top and won't dispense.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'cups_lids' and m.code = 's5';

update public.checklist_items i
set title = 'Cup and drink garbage',
    details = $txt$Quick look. Empty it only if it is worth it.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'garbage' and m.code = 's5';

update public.checklist_items i
set title = 'Clean Robot Claw (delicately)',
    details = $txt$1. The arm and claw are very sensitive to pressure and easy to knock off calibration.
2. Use very hot water on a towel and press lightly.
3. Don't scrub and don't push.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'claw' and m.code = 's5';

update public.checklist_items i
set title = 'Glass and surfaces',
    details = $txt$If splashes or marks would make you not want to buy from it, wipe it.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'glass' and m.code = 's5';

update public.checklist_items i
set title = 'Wipe the Cameo',
    details = $txt$If splashes or marks would make you not want to buy from it, wipe it.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'wipe_cameo' and m.code = 's5';

update public.checklist_items i
set title = 'Close-up check',
    details = $txt$1. The drink dispensing elevators sit higher when the kiosk is running than when they are open for servicing.
2. They slide down to the customer opening, and there is less space at the top.
3. Leave clear space above anything you put back, and do not stack anything into that path.
4. A blocked elevator takes the kiosk out of service and can break it.

Additional info
Other doors on the kiosk are separate. Do not block those either.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'door_check' and m.code = 's5';

update public.checklist_items i
set title = 'Update consumables in KC Manager',
    details = $txt$Enter what you filled. Confirm updates in command history.

Additional info
For milk in the Kiosoft consumables app only: enter the actual amount added minus 500 mL (example: add 8,000 mL → enter 7,500 mL). This does not change how much milk you actually add, and it does not change KioskOps inventory or rewrite history. Do not use the old 1,000–1,500 mL under-report text.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'kc_consumables' and m.code = 's5';

update public.checklist_items i
set title = 'Exit maintenance mode'
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'exit_maint' and m.code = 's5';

update public.checklist_items i
set title = 'Test drink',
    details = $txt$Have a test drink, whatever you want. You can also offer it to someone nearby. If you're unsure a drink will make properly, test that one.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'test_drink' and m.code = 's5';

update public.checklist_items i
set title = 'Deep clean milk nozzles'
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'deep_clean_nozzles' and m.code = 's5';

update public.checklist_items i
set title = 'Deep clean fridges'
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'deep_clean_fridges' and m.code = 's5';


-- Move UofT scale_check into Before maintenance mode (independent ticks preserved; new visits only).
do $move$
declare
  v_before uuid;
  v_during uuid;
begin
  select s.id into v_before
  from public.checklist_sections s
  join public.checklist_templates t on t.id = s.template_id
  join public.models m on m.id = t.model_id
  where m.code = 's22' and t.published and s.title = 'Before maintenance mode'
  order by t.version desc limit 1;

  select s.id into v_during
  from public.checklist_sections s
  join public.checklist_templates t on t.id = s.template_id
  join public.models m on m.id = t.model_id
  where m.code = 's22' and t.published and s.title = 'While the cleaning runs'
  order by t.version desc limit 1;

  if v_before is null then
    raise exception 's22 Before maintenance mode section missing';
  end if;

  update public.checklist_items
    set section_id = v_before,
        position = 2
  where key = 'scale_check' and section_id = v_during;

  -- if already moved or never in during, still ensure it lives under before_maint
  update public.checklist_items i
    set section_id = v_before,
        position = greatest(i.position, 2)
  from public.checklist_sections s
  join public.checklist_templates t on t.id = s.template_id
  join public.models m on m.id = t.model_id
  where i.section_id = s.id and i.key = 'scale_check' and m.code = 's22' and t.published
    and i.section_id is distinct from v_before;
end
$move$;

create or replace function private.stamp_visit_not_needed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  denied text[] := array[
    'kc_sign_in', 'gloves', 'maintenance_mode', 'long_water', 'start_milk_clean',
    'syrup', 'powder_clean', 'glass', 'wipe_cameo', 'door_check', 'exit_maint', 'test_drink'
  ];
begin
  if new.checklist_snapshot is null then
    return new;
  end if;
  new.checklist_snapshot := jsonb_set(
    new.checklist_snapshot,
    '{sections}',
    coalesce((
      select jsonb_agg(
        jsonb_set(
          sec,
          '{items}',
          coalesce((
            select jsonb_agg(
              case
                when item->>'key' = any (denied) then item || jsonb_build_object('not_needed_allowed', false)
                else item || jsonb_build_object('not_needed_allowed', true)
              end
              order by ord
            )
            from jsonb_array_elements(coalesce(sec->'items', '[]'::jsonb)) with ordinality as t(item, ord)
          ), '[]'::jsonb)
        )
        order by sord
      )
      from jsonb_array_elements(coalesce(new.checklist_snapshot->'sections', '[]'::jsonb)) with ordinality as s(sec, sord)
    ), '[]'::jsonb)
  );
  return new;
end;
$$;

revoke all on function private.stamp_visit_not_needed() from public, anon, authenticated;

drop trigger if exists service_sessions_stamp_not_needed on public.service_sessions;
create trigger service_sessions_stamp_not_needed
  before insert on public.service_sessions
  for each row execute function private.stamp_visit_not_needed();

create or replace function public.save_completion(
  p_session uuid,
  p_item uuid,
  p_state text,
  p_value text,
  p_note text,
  p_override_reason text,
  p_rev integer,
  p_key uuid,
  p_step text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.service_sessions;
  v_row public.service_item_completions;
  v_person uuid;
  v_key text;
  v_locked boolean;
  v_skip text;
  v_minutes integer;
  v_running boolean;
begin
  v_person := private.current_person_id();
  if v_person is null then
    raise exception 'Not signed in.';
  end if;
  if p_state not in ('done', 'not_needed', 'na', 'override') then
    raise exception 'Unknown step state.';
  end if;
  if p_key is null then
    raise exception 'Missing idempotency key.';
  end if;

  select * into v_session from public.service_sessions where id = p_session;
  if not found then
    raise exception 'Visit not found.';
  end if;
  if v_session.person_id <> v_person and not private.is_admin() then
    raise exception 'Not allowed.';
  end if;
  if v_session.is_sandbox is distinct from private.in_practice() and not private.is_admin() then
    raise exception 'Switch Practice mode so it matches this visit.';
  end if;

  select * into v_row
  from public.service_item_completions
  where session_id = p_session and item_id = p_item;

  if v_session.status <> 'open' then
    if v_row.id is not null then
      return to_jsonb(v_row);
    end if;
    raise exception 'This visit is already submitted.';
  end if;

  if v_row.id is not null and v_row.client_rev > coalesce(p_rev, 0) then
    return to_jsonb(v_row);
  end if;

  select item->>'key', (item->>'locked_during_clean') = 'true', item->>'not_needed_allowed'
    into v_key, v_locked, v_skip
  from jsonb_array_elements(coalesce(v_session.checklist_snapshot->'sections', '[]'::jsonb)) sec
  cross join lateral jsonb_array_elements(coalesce(sec->'items', '[]'::jsonb)) item
  where item->>'id' = p_item::text
  limit 1;

  if v_key is null then
    select i.key, i.locked_during_clean
      into v_key, v_locked
    from public.checklist_items i
    where i.id = p_item;
  end if;

  if p_state = 'not_needed' and v_skip = 'false' then
    raise exception 'This step is part of every service.';
  end if;

  v_minutes := nullif(v_session.checklist_snapshot->>'milk_clean_minutes', '')::integer;
  if v_minutes is null then
    select m.milk_clean_minutes into v_minutes
    from public.sites s
    join public.models m on m.id = s.model_id
    where s.id = v_session.site_id;
  end if;

  v_running := v_session.milk_clean_started_at is not null
    and v_session.milk_clean_done_at is null
    and coalesce(v_minutes, 0) > 0
    and now() < v_session.milk_clean_started_at + make_interval(mins => v_minutes);

  if v_running and coalesce(v_locked, false) then
    if v_key = 'wipe_cameo' then
      if p_state is distinct from 'not_needed' then
        raise exception 'Done unlocks when milk cleaning finishes. You can mark Not needed now.';
      end if;
    else
      raise exception 'This step stays locked until milk cleaning finishes.';
    end if;
  end if;

  if v_row.id is null then
    insert into public.service_item_completions (
      session_id, item_id, state, value, note, override_reason,
      client_rev, idempotency_key, updated_at, created_by
    ) values (
      p_session, p_item, p_state, p_value, p_note, p_override_reason,
      coalesce(p_rev, 0), p_key, now(), auth.uid()
    )
    on conflict (session_id, item_id) do update
      set state = excluded.state,
          value = excluded.value,
          note = excluded.note,
          override_reason = excluded.override_reason,
          client_rev = excluded.client_rev,
          updated_at = now()
      where public.service_item_completions.client_rev <= excluded.client_rev
    returning * into v_row;
  else
    update public.service_item_completions
      set state = p_state,
          value = p_value,
          note = p_note,
          override_reason = p_override_reason,
          client_rev = coalesce(p_rev, 0),
          updated_at = now()
      where id = v_row.id
        and client_rev <= coalesce(p_rev, 0)
      returning * into v_row;
  end if;

  if p_step is not null then
    update public.service_sessions
      set current_step_key = p_step
      where id = p_session and status = 'open';
  end if;

  return to_jsonb(v_row);
end;
$$;


-- Runtime thresholds (site_item_settings). Does not rewrite visit history.
-- Beans all sites: 67% full (= below two-thirds). Powder: 50% full. Concentrate UofT: 67%.
-- Cups: Sinai 45 cups, UofT 70 cups, RBC fill to top instruction.

update public.site_item_settings sis
set threshold_value = 67, threshold_unit = '% full'
from public.checklist_items i
where sis.item_id = i.id and i.key = 'fill_beans';

update public.site_item_settings sis
set threshold_value = 50, threshold_unit = '% full'
from public.checklist_items i
where sis.item_id = i.id and i.key = 'powder_fill';

update public.site_item_settings sis
set threshold_value = 67, threshold_unit = '% full'
from public.checklist_items i
where sis.item_id = i.id and i.key = 'concentrate';

update public.site_item_settings sis
set threshold_value = 45, threshold_unit = 'cups'
from public.checklist_items i
join public.checklist_sections sec on sec.id = i.section_id
join public.checklist_templates t on t.id = sec.template_id
join public.models m on m.id = t.model_id
join public.sites s on s.model_id = m.id
where sis.item_id = i.id
  and sis.site_id = s.id
  and i.key = 'cups_lids'
  and m.code = 's35';

update public.site_item_settings sis
set threshold_value = 70, threshold_unit = 'cups'
from public.checklist_items i
join public.checklist_sections sec on sec.id = i.section_id
join public.checklist_templates t on t.id = sec.template_id
join public.models m on m.id = t.model_id
join public.sites s on s.model_id = m.id
where sis.item_id = i.id
  and sis.site_id = s.id
  and i.key = 'cups_lids'
  and m.code = 's22';

update public.site_item_settings sis
set threshold_value = null, threshold_unit = 'Fill cups and lids to the top every visit'
from public.checklist_items i
join public.checklist_sections sec on sec.id = i.section_id
join public.checklist_templates t on t.id = sec.template_id
join public.models m on m.id = t.model_id
join public.sites s on s.model_id = m.id
where sis.item_id = i.id
  and sis.site_id = s.id
  and i.key = 'cups_lids'
  and m.code = 's5';

insert into public.config (key, value)
values ('arm_sensor_criteria', 'sinai_solid_green_approved_2026-11-08')
on conflict (key) do update set value = excluded.value;

insert into public.config (key, value)
values ('servicing_ops_facts_migration', '0016')
on conflict (key) do update set value = excluded.value;

insert into public.config (key, value)
values ('milk_stock_entry_rule', 'kiosoft_enter_actual_minus_500ml')
on conflict (key) do update set value = excluded.value;

-- Refresh draft quiz bank to match checklists/quiz.yaml (includes Kiosoft milk actual−500).
-- Does not invent handling for milk volumes under 500 mL.
delete from public.quiz_questions q
using public.models m
where q.model_id = m.id and m.code in ('s35', 's22', 's5');

-- s35: 12 questions
insert into public.quiz_questions (model_id, position, prompt, choices, answer_index, explanation, draft)
select m.id, 0, 'Why do beans, pucks, and cleaning balls come before you start milk cleaning?', '["So the visit is shorter on paper", "Touching the Cameo (bean lid, puck bin, or the top for cleaning balls) aborts the cleaning and it has to restart", "Those steps only work during the cleaning", "The milk tubes have to be on the bags first"]'::jsonb, 1, 'Touching the Cameo during the cleaning aborts it. Do the prep first. The cleaning is about 11 minutes.', true
from public.models m where m.code = 's35';

insert into public.quiz_questions (model_id, position, prompt, choices, answer_index, explanation, draft)
select m.id, 1, 'How long is the Cameo milk cleaning at Sinai?', '["About 9 minutes", "About 11 minutes", "About 48 minutes", "Until the bag is empty"]'::jsonb, 1, 'Sinai Series 3.5 is about 11 minutes. RBC Series 5 is about 18. UofT is about 9.', true
from public.models m where m.code = 's35';

insert into public.quiz_questions (model_id, position, prompt, choices, answer_index, explanation, draft)
select m.id, 2, 'What should you do once the cleaning has started?', '["Stand and watch the Cameo the whole time", "Be as productive as possible, and aim to finish the other tasks close to when the cleaning is done", "Lift the bean lid so you can refill during the cycle", "Exit maintenance mode right away"]'::jsonb, 1, 'Use the cleaning time to do the other tasks. Finish close to when it is done.', true
from public.models m where m.code = 's35';

insert into public.quiz_questions (model_id, position, prompt, choices, answer_index, explanation, draft)
select m.id, 3, 'During milk cleaning, what is true about the milk?', '["Do not change bags until the cleaning is finished", "You can change milk bags and top up milk, but do not touch the tubes", "Pull the tubes out and rinse them", "Oat milk is not used at Sinai"]'::jsonb, 1, 'The tubes are in the hot water and Everclean container. You can change bags and top up. Don''t touch the tubes.', true
from public.models m where m.code = 's35';

insert into public.quiz_questions (model_id, position, prompt, choices, answer_index, explanation, draft)
select m.id, 4, 'What happens if the three powder spouts are left facing up?', '["The drinks are sweeter", "Powder drinks come out as plain hot water", "The Cameo will not start", "The door will not close"]'::jsonb, 1, 'All three spouts go back to down-facing, or powder drinks come out as hot water.', true
from public.models m where m.code = 's35';

insert into public.quiz_questions (model_id, position, prompt, choices, answer_index, explanation, draft)
select m.id, 5, 'When do you have the test drink?', '["Before maintenance mode", "During milk cleaning", "Last, after you exit maintenance mode", "Whenever the line is short"]'::jsonb, 2, 'The test drink is the last thing before you leave, after maintenance mode is off.', true
from public.models m where m.code = 's35';

insert into public.quiz_questions (model_id, position, prompt, choices, answer_index, explanation, draft)
select m.id, 6, 'What is true about the service doors?', '["The space is the same while servicing and while a drink is made", "When a drink is made, the door slides down and there is less space at the top. Don''t stack items into the door path", "Door clearance is only a 2.2 step", "Stack cups high so they are easy to reach"]'::jsonb, 1, 'The door slides down to the customer opening. A blocked door takes the kiosk out of service and can break the door.', true
from public.models m where m.code = 's35';

insert into public.quiz_questions (model_id, position, prompt, choices, answer_index, explanation, draft)
select m.id, 7, 'How do you wipe the robot claw?', '["Scrub with a dry pad", "Very hot water on a towel, press lightly. Don''t scrub and don''t push", "Skip it unless someone complains", "Only after arm calibration, with firm pressure"]'::jsonb, 1, 'The arm and claw are very sensitive to pressure and easy to knock off calibration.', true
from public.models m where m.code = 's35';

insert into public.quiz_questions (model_id, position, prompt, choices, answer_index, explanation, draft)
select m.id, 8, 'When are arm calibration and the arm sensor check done?', '["Every visit, after maintenance mode", "Weekly, early in the visit, before maintenance mode", "Only on show days", "Monthly, during milk cleaning"]'::jsonb, 1, 'They are weekly and cannot be done in maintenance mode, so they come first.', true
from public.models m where m.code = 's35';

insert into public.quiz_questions (model_id, position, prompt, choices, answer_index, explanation, draft)
select m.id, 9, 'What do you do on the Sinai arm sensor check?', '["Fail the visit if you are unsure", "Confirm solid green at hot and cold positions; gently wipe the reflective surface only if needed", "The pass/fail criteria are not confirmed yet. Note what you see", "Skip the step until next season"]'::jsonb, 1, 'Mount Sinai only. Solid green at single hot and single cold. This is not the Auto Calibrate weight check (190–210 g).', true
from public.models m where m.code = 's35';

insert into public.quiz_questions (model_id, position, prompt, choices, answer_index, explanation, draft)
select m.id, 10, 'When do you refill beans?', '["Whenever the hopper is not completely full", "Only if below two-thirds; at or above two-thirds leave alone", "Only if below half", "Only after milk cleaning"]'::jsonb, 1, 'Beans use a two-thirds minimum. Exactly two-thirds is not below, so do not refill.', true
from public.models m where m.code = 's35';

insert into public.quiz_questions (model_id, position, prompt, choices, answer_index, explanation, draft)
select m.id, 11, 'What cleaner do you use for the Sinai Cameo milk clean?', '["30 mL blue Rinza", "30 mL EverClean (not Rinza)", "750 mL water only", "Whatever is under the sink"]'::jsonb, 1, 'Sinai and RBC Cameo milk cleaning uses 30 mL EverClean, not Rinza.', true
from public.models m where m.code = 's35';

-- s22: 12 questions
insert into public.quiz_questions (model_id, position, prompt, choices, answer_index, explanation, draft)
select m.id, 0, 'How long is the UofT milk-module cleaning?', '["About 9 minutes", "About 18 minutes", "About 48 minutes", "It has no timed cleaning"]'::jsonb, 0, 'The 2.2 milk module is about 9 minutes. Series 3.5 is about 11. Series 5 is about 18.', true
from public.models m where m.code = 's22';

insert into public.quiz_questions (model_id, position, prompt, choices, answer_index, explanation, draft)
select m.id, 1, 'What has to happen before you start the milk-module cleaning?', '["A test drink", "The kiosk is in maintenance mode", "Scale calibration check", "Exit maintenance mode"]'::jsonb, 1, 'Maintenance mode comes before the cleaning. Don''t touch the module mid-cycle.', true
from public.models m where m.code = 's22';

insert into public.quiz_questions (model_id, position, prompt, choices, answer_index, explanation, draft)
select m.id, 2, 'During the cleaning, what may you do with the milk?', '["Change the bag and top up 2% milk, and do not touch the tubes", "Change the bag only after the cleaning ends", "Top up coffee concentrate and skip the milk", "Rinse the tubes in the sink"]'::jsonb, 0, 'You can change the bag and top up during the cleaning. UofT is 2% only. Don''t touch the tubes.', true
from public.models m where m.code = 's22';

insert into public.quiz_questions (model_id, position, prompt, choices, answer_index, explanation, draft)
select m.id, 3, 'Where do the milk tubes sit in the bag at UofT?', '["Both tubes touch the bottom of the bag", "The suction tube sits 1 inch lower than the sensor tube", "The sensor tube sits on the bottom and the suction tube floats", "Tube height does not matter on the 2.2"]'::jsonb, 1, 'When tubes go back in the milk, suction must sit 1 inch lower than the sensor tube.', true
from public.models m where m.code = 's22';

insert into public.quiz_questions (model_id, position, prompt, choices, answer_index, explanation, draft)
select m.id, 4, 'What cleaner mix does the UofT milk frother use?', '["30 mL EverClean only", "750 mL water and 30 mL blue Rinza", "Hot water from the Cameo twice", "No cleaner — water rinse only"]'::jsonb, 1, 'UofT uses 750 mL water + 30 mL Rinza. EverClean is for Sinai/RBC Cameo milk cleaning.', true
from public.models m where m.code = 's22';

insert into public.quiz_questions (model_id, position, prompt, choices, answer_index, explanation, draft)
select m.id, 5, 'What happens if the three powder spouts are left facing up?', '["Nothing changes", "Powder drinks come out as plain hot water", "The milk module stops", "Syrup keeps pouring"]'::jsonb, 1, 'All three spouts go back to down-facing.', true
from public.models m where m.code = 's22';

insert into public.quiz_questions (model_id, position, prompt, choices, answer_index, explanation, draft)
select m.id, 6, 'What is different about syrup cleaning at UofT?', '["Skip syrup cleaning", "Move the cup holder out of the way", "Turn all three powder spouts down", "Do it twice"]'::jsonb, 1, 'At UofT, move the cup holder out of the way. Syrup cleaning is once per visit.', true
from public.models m where m.code = 's22';

insert into public.quiz_questions (model_id, position, prompt, choices, answer_index, explanation, draft)
select m.id, 7, 'How often is the scale calibration check?', '["Weekly", "Every visit", "Only on Mondays", "There is no scale check"]'::jsonb, 1, 'The scale calibration check is every visit at UofT.', true
from public.models m where m.code = 's22';

insert into public.quiz_questions (model_id, position, prompt, choices, answer_index, explanation, draft)
select m.id, 8, 'When do you have the test drink?', '["First, to see what is broken", "During the milk cleaning", "Last, after you exit maintenance mode, with a milk-based drink", "Only if a customer asks"]'::jsonb, 2, 'Last step after exit maintenance. At UofT the test drink must be milk-based so the frother self-rinses.', true
from public.models m where m.code = 's22';

insert into public.quiz_questions (model_id, position, prompt, choices, answer_index, explanation, draft)
select m.id, 9, 'Which of these is not a UofT step?', '["Coffee concentrate", "Service-door clearance", "Cups and lids", "Glass and surfaces"]'::jsonb, 1, 'No door close-up check, claw, or Cameo items at UofT. No grey water. It drains to a pipe.', true
from public.models m where m.code = 's22';

insert into public.quiz_questions (model_id, position, prompt, choices, answer_index, explanation, draft)
select m.id, 10, 'What should you do during the 9 minutes?', '["Wait beside the module", "Be as productive as possible, and aim to finish the other tasks close to when the cleaning is done", "Open the module to speed it up", "Leave and come back tomorrow"]'::jsonb, 1, 'Use the cleaning time. Finish the other tasks close to when it is done.', true
from public.models m where m.code = 's22';

insert into public.quiz_questions (model_id, position, prompt, choices, answer_index, explanation, draft)
select m.id, 11, 'You added 8,000 mL of milk. What do you enter in Kiosoft consumables?', '["8,000 mL", "7,500 mL (actual added minus 500 mL)", "6,500–7,000 mL (old 1,000–1,500 under-report)", "Nothing — KioskOps inventory subtracts it automatically"]'::jsonb, 1, 'Manual Kiosoft entry only — actual added minus 500 mL. Does not change how much you pour or KioskOps inventory.', true
from public.models m where m.code = 's22';

-- s5: 11 questions
insert into public.quiz_questions (model_id, position, prompt, choices, answer_index, explanation, draft)
select m.id, 0, 'How long is the Cameo milk cleaning at RBC?', '["About 9 minutes", "About 18 minutes", "Only for the length of the show", "There is no milk cleaning on show days"]'::jsonb, 1, 'RBC Series 5 uses the Cameo. The cleaning is about 18 minutes.', true
from public.models m where m.code = 's5';

insert into public.quiz_questions (model_id, position, prompt, choices, answer_index, explanation, draft)
select m.id, 1, 'When is the milk bag changed at RBC?', '["Every show, no matter how fresh the bag is", "When the bag has been in use 4 days, the same rule as the other sites", "Only at the start of the season", "Never. RBC has no milk bags"]'::jsonb, 1, 'Days since the fresh bag, not every show. Same 4-day rule.', true
from public.models m where m.code = 's5';

insert into public.quiz_questions (model_id, position, prompt, choices, answer_index, explanation, draft)
select m.id, 2, 'Before you bring the grey-water hose back in, the clasp must be', '["Parallel to the hose (open)", "Perpendicular to the hose (closed)", "Removed", "Pointed at the drain"]'::jsonb, 1, 'RBC grey water sits in a container under the kiosk with a coiled hose. Drain via the hose to the ground drain, then close the clasp before coiling the hose back.', true
from public.models m where m.code = 's5';

insert into public.quiz_questions (model_id, position, prompt, choices, answer_index, explanation, draft)
select m.id, 3, 'You added 8,000 mL of milk. What do you enter in Kiosoft consumables?', '["8,000 mL", "7,500 mL (actual added minus 500 mL)", "6,500–7,000 mL (old 1,000–1,500 under-report)", "Nothing — KioskOps inventory subtracts it automatically"]'::jsonb, 1, 'Manual Kiosoft entry only — actual added minus 500 mL. Does not change how much you pour or KioskOps inventory.', true
from public.models m where m.code = 's5';

insert into public.quiz_questions (model_id, position, prompt, choices, answer_index, explanation, draft)
select m.id, 4, 'Why do beans, pucks, and cleaning balls come before milk cleaning?', '["They are optional", "Touching the Cameo during the cleaning aborts it", "They can only be done in maintenance mode after the cleaning", "The show cannot start until the puck bin is full"]'::jsonb, 1, 'Bean lid, puck bin, and the top for cleaning balls abort the cleaning if you touch them mid-cycle.', true
from public.models m where m.code = 's5';

insert into public.quiz_questions (model_id, position, prompt, choices, answer_index, explanation, draft)
select m.id, 5, 'What happens if the three powder spouts are left facing up?', '["Powder drinks come out as plain hot water", "The hose leaks", "The claw loses calibration", "Nothing"]'::jsonb, 0, 'All three spouts go back to down-facing.', true
from public.models m where m.code = 's5';

insert into public.quiz_questions (model_id, position, prompt, choices, answer_index, explanation, draft)
select m.id, 6, 'How do you wipe the robot claw?', '["Scrub hard so the show looks clean", "Very hot water on a towel, press lightly. Don''t scrub and don''t push", "Skip it on show days", "Only with a dry brush"]'::jsonb, 1, 'The arm and claw are very sensitive to pressure.', true
from public.models m where m.code = 's5';

insert into public.quiz_questions (model_id, position, prompt, choices, answer_index, explanation, draft)
select m.id, 7, 'What is true about the service doors?', '["RBC has no door check", "When a drink is made, the door slides down and there is less space at the top. Don''t stack items into the door path", "Stack stock in the door path so it stays dry", "The doors are only checked monthly"]'::jsonb, 1, 'The close-up check applies at RBC. A blocked door takes the kiosk out of service and can break the door.', true
from public.models m where m.code = 's5';

insert into public.quiz_questions (model_id, position, prompt, choices, answer_index, explanation, draft)
select m.id, 8, 'When are arm calibration and the arm sensor check done?', '["Weekly, before maintenance mode", "Every show, during milk cleaning", "Only in the off season", "After the test drink"]'::jsonb, 0, 'Weekly, early, before maintenance mode. Auto Calibrate weight stays 190–210 g inclusive.', true
from public.models m where m.code = 's5';

insert into public.quiz_questions (model_id, position, prompt, choices, answer_index, explanation, draft)
select m.id, 9, 'What should you do on the arm sensor check at RBC?', '["Treat solid green sensors as a confirmed pass using Sinai criteria", "Mark Not needed — the solid-green sensor check is Mount Sinai only", "Skip the whole weekly arm calibration", "Fail the kiosk if you see a laser"]'::jsonb, 1, 'Sinai-only sensor check. RBC still does the weekly Auto Calibrate weight procedure.', true
from public.models m where m.code = 's5';

insert into public.quiz_questions (model_id, position, prompt, choices, answer_index, explanation, draft)
select m.id, 10, 'When do you have the test drink?', '["Before the show, as the last step, after maintenance mode is off", "While the Cameo is cleaning", "Before maintenance mode", "Only if there is a lineup"]'::jsonb, 0, 'The test drink is the last thing before you leave, after you exit maintenance mode.', true
from public.models m where m.code = 's5';

insert into public.config (key, value)
values ('milk_stock_under_500ml_rule', 'unspecified_flag_only')
on conflict (key) do update set value = excluded.value;

