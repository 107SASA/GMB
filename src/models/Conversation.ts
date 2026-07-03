import mongoose, { Schema, Document } from 'mongoose';

export interface IConversation extends Document {
  tenantId: string;
  organizationId?: string;
  businessId: mongoose.Types.ObjectId;
  leadId: mongoose.Types.ObjectId;
  
  direction: 'inbound' | 'outbound';
  messageText: string;
  isAI: boolean;
  messageStatus: 'sent' | 'delivered' | 'read' | 'failed' | 'received';
  twilioSid?: string;
  metadata?: any;
  // ADDITIVE — links a message to its ConversationThread (used as the
  // "Session ID" for WhatsApp AI Agent chat-history storage, Feature 7).
  threadId?: mongoose.Types.ObjectId;

  timestamp: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ConversationSchema: Schema = new Schema(
  {
    tenantId: { type: String, required: true, index: true },
    organizationId: { type: String },
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
    
    direction: { type: String, enum: ['inbound', 'outbound'], required: true },
    messageText: { type: String, required: true },
    isAI: { type: Boolean, default: false },
    messageStatus: { 
      type: String, 
      enum: ['sent', 'delivered', 'read', 'failed', 'received'],
      default: 'received'
    },
    twilioSid: { type: String },
    metadata: { type: Schema.Types.Mixed },
    threadId: { type: Schema.Types.ObjectId, ref: 'ConversationThread', index: true },

    timestamp: { type: Date, default: Date.now, index: true }
  },
  { timestamps: true }
);

export default mongoose.models.Conversation || mongoose.model<IConversation>('Conversation', ConversationSchema);
