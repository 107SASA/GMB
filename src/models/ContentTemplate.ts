import mongoose, { Schema, Document } from 'mongoose';

export interface IContentTemplate extends Document {
  templateType: string;
  tone: string;
  structure: string;
  prompts: string[];
  createdAt: Date;
  updatedAt: Date;
}

const ContentTemplateSchema: Schema = new Schema(
  {
    templateType: { type: String, required: true, index: true },
    tone: { type: String, required: true },
    structure: { type: String, required: true },
    prompts: [{ type: String }],
  },
  { timestamps: true }
);

export default mongoose.models.ContentTemplate || mongoose.model<IContentTemplate>('ContentTemplate', ContentTemplateSchema);
