-- AlterTable: add emailSenderName and emailReplyTo to ShopSettings
ALTER TABLE "ShopSettings" ADD COLUMN "emailSenderName" TEXT;
ALTER TABLE "ShopSettings" ADD COLUMN "emailReplyTo" TEXT;
