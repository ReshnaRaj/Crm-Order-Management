/*
  Warnings:

  - Added the required column `payloadHash` to the `OrderCreationRequest` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "OrderCreationRequest" ADD COLUMN     "payloadHash" TEXT NOT NULL;
