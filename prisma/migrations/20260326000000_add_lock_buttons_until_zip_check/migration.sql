-- AlterTable: add lockButtonsUntilZipCheck to WidgetConfig
ALTER TABLE "WidgetConfig" ADD COLUMN IF NOT EXISTS "lockButtonsUntilZipCheck" BOOLEAN NOT NULL DEFAULT true;
