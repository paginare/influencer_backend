import mongoose, { Schema, Document, Types } from 'mongoose';
import { IUser } from './User';
import { ISale } from './Sale';

// Interface representing a commission payment record.
export interface ICommissionPayment extends Document {
  user: Types.ObjectId | IUser; // User (Influencer or Manager) receiving the commission
  roleAtPayment: 'influencer' | 'manager'; // Role of the user when this commission was earned
  sales: (Types.ObjectId | ISale)[]; // Array of Sale IDs included in this payment calculation
  totalSalesValue: number; // Total value of sales considered for this payment
  commissionEarned: number; // Total commission amount for this period
  paymentPeriodStart: Date; // Start date of the period for which commission is calculated
  paymentPeriodEnd: Date; // End date of the period
  calculationDate: Date; // Date when the commission was calculated
  status: 'pending' | 'paid' | 'failed'; // Status of the payment
  paymentDate?: Date; // Date when the payment was actually made
  transactionId?: string; // Optional transaction ID from the payment gateway
  createdAt: Date;
  updatedAt: Date;
}

const CommissionPaymentSchema: Schema<ICommissionPayment> = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    roleAtPayment: { type: String, enum: ['influencer', 'manager'], required: true },
    sales: [{ type: Schema.Types.ObjectId, ref: 'Sale' }],
    totalSalesValue: { type: Number, required: true, min: 0 },
    commissionEarned: { type: Number, required: true, min: 0 },
    paymentPeriodStart: { type: Date, required: true },
    paymentPeriodEnd: { type: Date, required: true },
    calculationDate: { type: Date, default: Date.now },
    status: { type: String, enum: ['pending', 'paid', 'failed'], default: 'pending' },
    paymentDate: { type: Date },
    transactionId: { type: String },
  },
  {
    timestamps: true,
  }
);

// Indexing for faster lookups
CommissionPaymentSchema.index({ user: 1, status: 1 });
CommissionPaymentSchema.index({ paymentPeriodStart: -1, paymentPeriodEnd: -1 });

const CommissionPayment = mongoose.model<ICommissionPayment>('CommissionPayment', CommissionPaymentSchema);

export default CommissionPayment; 