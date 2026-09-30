-- Station ownership, from the real catalogue. Nullable: creators have none,
-- and a contact imported before this column existed has no answer to invent.
ALTER TABLE "Contact" ADD COLUMN "owner" TEXT;
