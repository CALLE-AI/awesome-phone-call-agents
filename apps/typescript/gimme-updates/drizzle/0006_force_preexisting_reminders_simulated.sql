-- Migration 0005 added is_simulated DEFAULT false, so every reminder that
-- already existed became real-call-eligible without an explicit choice.
-- None of those rows were created by a verified real digest call.
-- Force them back to simulated and unresolved so cron will not dial them.
UPDATE `reminders`
SET `is_simulated` = 1,
    `status` = 'unresolved'
WHERE `is_simulated` = 0;
