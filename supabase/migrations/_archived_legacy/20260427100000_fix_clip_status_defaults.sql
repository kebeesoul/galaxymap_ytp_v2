-- Remove auto-queue defaults: new clips should have NULL status until explicitly triggered
ALTER TABLE clips ALTER COLUMN render_status DROP DEFAULT;
ALTER TABLE clips ALTER COLUMN transcribe_status DROP DEFAULT;
