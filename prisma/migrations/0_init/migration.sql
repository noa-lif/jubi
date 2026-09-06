-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "categories" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER,
    "name" VARCHAR(100) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_imports" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "file_hash" VARCHAR(64) NOT NULL,
    "filename" VARCHAR(255) NOT NULL,
    "uploaded_at" TIMESTAMP(6) NOT NULL,
    "transaction_count" INTEGER NOT NULL,

    CONSTRAINT "file_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "token" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMP(6) NOT NULL,
    "used" BOOLEAN NOT NULL,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "business_name" VARCHAR(255) NOT NULL,
    "category_id" INTEGER,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "id_number" VARCHAR(50) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ix_categories_id" ON "categories"("id");

-- CreateIndex
CREATE INDEX "ix_categories_user_id" ON "categories"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_category_user_name" ON "categories"("user_id", "name");

-- CreateIndex
CREATE INDEX "ix_file_imports_id" ON "file_imports"("id");

-- CreateIndex
CREATE INDEX "ix_file_imports_user_id" ON "file_imports"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_file_import_user_hash" ON "file_imports"("user_id", "file_hash");

-- CreateIndex
CREATE UNIQUE INDEX "ix_password_reset_tokens_token" ON "password_reset_tokens"("token");

-- CreateIndex
CREATE INDEX "ix_password_reset_tokens_id" ON "password_reset_tokens"("id");

-- CreateIndex
CREATE INDEX "ix_password_reset_tokens_user_id" ON "password_reset_tokens"("user_id");

-- CreateIndex
CREATE INDEX "ix_transactions_date" ON "transactions"("date");

-- CreateIndex
CREATE INDEX "ix_transactions_id" ON "transactions"("id");

-- CreateIndex
CREATE INDEX "ix_transactions_user_id" ON "transactions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "ix_users_email" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_id_number_key" ON "users"("id_number");

-- CreateIndex
CREATE INDEX "ix_users_id" ON "users"("id");

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "file_imports" ADD CONSTRAINT "file_imports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

