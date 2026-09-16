-- A rebrand does not erase the name people still use. MERA FM 107.4 launched
-- as Samaa FM in 2012 and rebranded in November 2021; merging the duplicate
-- rows would otherwise lose the name half the market searches for.
ALTER TABLE "Contact" ADD COLUMN "formerName" TEXT;
