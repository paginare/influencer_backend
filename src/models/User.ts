import mongoose, { Schema, Document, Types } from 'mongoose';
import bcrypt from 'bcryptjs';

// Define the possible roles
export enum UserRole {
  ADMIN = 'admin',
  MANAGER = 'manager',
  INFLUENCER = 'influencer',
}

// Interface representing a document in MongoDB.
export interface IUser extends Document {
  name: string;
  email: string;
  password?: string; // Optional because it will be removed in toJSON
  role: UserRole;
  manager?: Types.ObjectId | IUser; // Link to manager (for influencers)
  influencers?: (Types.ObjectId | IUser)[]; // List of influencers managed (for managers)
  whatsappNumber?: string; // For WhatsApp notifications
  tokenWhats?: string; // For UAZapi notifications
  couponCode?: string; // Unique coupon code for influencers
  commissionRate?: number; // Base commission rate (can be overridden by commission tiers)
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidatePassword: string): Promise<boolean>;
  notifications: {
    welcome: boolean;
    report: boolean;
    reminder: boolean;
    reportFrequency: string;
    reminderThreshold: string;
    lastReportSentAt?: Date;
  };
  isActive: boolean;
  status: string;
  // Add field for custom message templates
  messageTemplates?: {
    welcome?: string;
    report?: string;
    reminder?: string;
    newSale?: string;
  };
  instagram?: string; // <-- Add instagram field
}

const UserSchema: Schema<IUser> = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, select: false }, // Hide password by default
    role: { type: String, enum: Object.values(UserRole), required: true },
    manager: { type: Schema.Types.ObjectId, ref: 'User', required: function(this: IUser) { return this.role === UserRole.INFLUENCER; } },
    influencers: [{ type: Schema.Types.ObjectId, ref: 'User' }], // Removido 'required' aqui, pois um manager pode não ter influencers inicialmente
    whatsappNumber: { type: String },
    tokenWhats: { type: String }, // <-- Adicionar campo para token UAZapi
    couponCode: { type: String, unique: true, sparse: true }, // Unique if exists, allows multiple nulls
    commissionRate: { type: Number, default: 0 }, // Default rate
    // Adicionando campo para configurações de notificação
    notifications: {
      welcome: { type: Boolean, default: true },
      report: { type: Boolean, default: true },
      reminder: { type: Boolean, default: false },
      reportFrequency: { type: String, default: 'weekly' },
      reminderThreshold: { type: String, default: '3days' },
      lastReportSentAt: { type: Date }
    },
    isActive: { type: Boolean, default: true }, // Adicionado para status
    status: { type: String, default: 'Ativo' }, // Adicionado para consistência com o frontend (pode ser redundante com isActive)
    // Add field for custom message templates to schema
    messageTemplates: {
      welcome: { type: String },
      report: { type: String },
      reminder: { type: String },
      newSale: { type: String },
    },
    instagram: { type: String } // <-- Add instagram field to schema
  },
  {
    timestamps: true, // Adds createdAt and updatedAt timestamps
    toJSON: {
        // Remove password when converting document to JSON
        transform(doc, ret) {
            delete ret.password;
            return ret;
        },
    },
  }
);

// Pre-save hook to hash password
UserSchema.pre<IUser>('save', async function (next) {
  // Only hash the password if it has been modified (or is new)
  if (!this.isModified('password') || !this.password) return next();

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error: any) {
    // Ensure the error is passed to the next middleware/handler
     return next(error);
  }
});

// Method to compare entered password with hashed password
UserSchema.methods.comparePassword = async function (candidatePassword: string): Promise<boolean> {
  if (!this.password) {
     return false; // Or throw an error, depending on how you want to handle users without passwords
  }
  return bcrypt.compare(candidatePassword, this.password);
};

const User = mongoose.model<IUser>('User', UserSchema);

export default User; 