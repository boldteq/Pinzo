-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN,
    "locale" TEXT,
    "collaborator" BOOLEAN,
    "emailVerified" BOOLEAN,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZipCode" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "zipCode" TEXT NOT NULL,
    "label" TEXT,
    "zone" TEXT,
    "message" TEXT,
    "eta" TEXT,
    "type" TEXT NOT NULL DEFAULT 'allowed',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "codAvailable" BOOLEAN,
    "returnPolicy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ZipCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryRule" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "zone" TEXT,
    "zipCodes" TEXT,
    "minOrderAmount" DOUBLE PRECISION,
    "deliveryFee" DOUBLE PRECISION,
    "freeShippingAbove" DOUBLE PRECISION,
    "estimatedDays" TEXT,
    "cutoffTime" TEXT,
    "daysOfWeek" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaitlistEntry" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "zipCode" TEXT NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaitlistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WidgetConfig" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "position" TEXT NOT NULL DEFAULT 'inline',
    "primaryColor" TEXT NOT NULL DEFAULT '#008060',
    "successColor" TEXT NOT NULL DEFAULT '#008060',
    "errorColor" TEXT NOT NULL DEFAULT '#D72C0D',
    "backgroundColor" TEXT NOT NULL DEFAULT '#FFFFFF',
    "textColor" TEXT NOT NULL DEFAULT '#202223',
    "heading" TEXT NOT NULL DEFAULT 'Check Delivery Availability',
    "placeholder" TEXT NOT NULL DEFAULT 'Enter your zip code',
    "buttonText" TEXT NOT NULL DEFAULT 'Check',
    "successMessage" TEXT NOT NULL DEFAULT 'Great news! We deliver to your area.',
    "errorMessage" TEXT NOT NULL DEFAULT 'Sorry, we don''t deliver to this area yet.',
    "notFoundMessage" TEXT NOT NULL DEFAULT 'This zip code was not found in our system.',
    "showEta" BOOLEAN NOT NULL DEFAULT true,
    "showZone" BOOLEAN NOT NULL DEFAULT false,
    "showWaitlistOnFailure" BOOLEAN NOT NULL DEFAULT false,
    "showCod" BOOLEAN NOT NULL DEFAULT true,
    "showReturnPolicy" BOOLEAN NOT NULL DEFAULT true,
    "showCutoffTime" BOOLEAN NOT NULL DEFAULT true,
    "showDeliveryDays" BOOLEAN NOT NULL DEFAULT true,
    "blockCartOnInvalid" BOOLEAN NOT NULL DEFAULT false,
    "blockCheckoutInCart" BOOLEAN NOT NULL DEFAULT false,
    "showSocialProof" BOOLEAN NOT NULL DEFAULT true,
    "borderRadius" TEXT NOT NULL DEFAULT '8',
    "customCss" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WidgetConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "planId" TEXT NOT NULL DEFAULT 'free',
    "billingInterval" TEXT NOT NULL DEFAULT 'monthly',
    "shopifySubscriptionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "trialEndsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopSettings" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "defaultBehavior" TEXT NOT NULL DEFAULT 'block',
    "notificationEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ZipCode_shop_zipCode_key" ON "ZipCode"("shop", "zipCode");

-- CreateIndex
CREATE INDEX "DeliveryRule_shop_idx" ON "DeliveryRule"("shop");

-- CreateIndex
CREATE INDEX "WaitlistEntry_shop_idx" ON "WaitlistEntry"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "WaitlistEntry_shop_email_zipCode_key" ON "WaitlistEntry"("shop", "email", "zipCode");

-- CreateIndex
CREATE UNIQUE INDEX "WidgetConfig_shop_key" ON "WidgetConfig"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_shop_key" ON "Subscription"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "ShopSettings_shop_key" ON "ShopSettings"("shop");
