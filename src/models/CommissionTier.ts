import mongoose, { Schema, Document } from 'mongoose';

// Interface representing a commission tier document in MongoDB.
export interface ICommissionTier extends Document {
  name: string;
  minSalesValue: number; // Minimum sales value for this tier
  maxSalesValue?: number; // Maximum sales value (optional, represents infinity if absent)
  commissionPercentage: number;
  appliesTo: 'influencer' | 'manager'; // Specify if this tier is for influencers or managers
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const CommissionTierSchema: Schema<ICommissionTier> = new Schema(
  {
    name: { type: String, required: true },
    minSalesValue: { type: Number, required: true, min: 0 },
    maxSalesValue: { type: Number, min: 0 },
    commissionPercentage: { type: Number, required: true, min: 0, max: 100 },
    appliesTo: { type: String, enum: ['influencer', 'manager'], required: true },
    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt timestamps
  }
);

// Ensure minSalesValue is less than maxSalesValue if maxSalesValue exists
CommissionTierSchema.path('maxSalesValue').validate(function (value) {
  return value === undefined || value === null || value >= this.minSalesValue;
}, 'maxSalesValue must be greater than or equal to minSalesValue');

const CommissionTier = mongoose.model<ICommissionTier>('CommissionTier', CommissionTierSchema);

export default CommissionTier; 