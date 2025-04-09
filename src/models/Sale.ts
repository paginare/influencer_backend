import mongoose, { Schema, Document, Types } from 'mongoose';
import { IUser } from './User'; // Assuming IUser is exported from User.ts

// Interface representing a sale document in MongoDB.
export interface ISale extends Document {
  influencer: Types.ObjectId | IUser; // Reference to the influencer who made the sale
  manager?: Types.ObjectId | IUser; // Reference to the influencer's manager at the time of sale
  orderId: string; // Unique identifier from the e-commerce platform
  saleValue: number; // The total value of the sale
  commissionCalculated: boolean; // Flag to indicate if commission has been processed
  influencerCommissionEarned?: number; // Amount of commission earned by the influencer
  managerCommissionEarned?: number; // Amount of commission earned by the manager
  couponCodeUsed?: string; // Coupon code used for the sale
  transactionDate: Date; // Date and time of the transaction
  processedViaWebhook: boolean; // Indicates if the sale came via webhook
  createdAt: Date;
  updatedAt: Date;
}

const SaleSchema: Schema<ISale> = new Schema(
  {
    influencer: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    manager: { type: Schema.Types.ObjectId, ref: 'User' }, // Manager associated at the time of sale
    orderId: { type: String, required: true, unique: true },
    saleValue: { type: Number, required: true, min: 0 },
    commissionCalculated: { type: Boolean, default: false },
    influencerCommissionEarned: { type: Number },
    managerCommissionEarned: { type: Number },
    couponCodeUsed: { type: String },
    transactionDate: { type: Date, default: Date.now, required: true },
    processedViaWebhook: { type: Boolean, default: false },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt timestamps
  }
);

// Indexing for faster queries
SaleSchema.index({ influencer: 1, transactionDate: -1 });
SaleSchema.index({ manager: 1, transactionDate: -1 });
SaleSchema.index({ couponCodeUsed: 1 });
SaleSchema.index({ commissionCalculated: 1 });

const Sale = mongoose.model<ISale>('Sale', SaleSchema);

export default Sale; 