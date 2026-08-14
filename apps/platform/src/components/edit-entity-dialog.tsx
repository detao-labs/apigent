"use client";

import * as React from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Textarea,
} from "@apigent/ui";

// ═══════════════════════════════════════════════════════════════════
// EditEntityDialog — 通用名称/描述编辑对话框（org / repo 共用）
// ═══════════════════════════════════════════════════════════════════

export interface EditEntityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  nameLabel: string;
  namePlaceholder: string;
  descriptionLabel: string;
  descriptionPlaceholder: string;
  saveLabel: string;
  cancelLabel: string;
  initialName: string;
  initialDescription: string;
  saving?: boolean;
  onSave: (input: { name: string; description: string }) => Promise<void> | void;
}

export function EditEntityDialog({
  open,
  onOpenChange,
  title,
  description,
  nameLabel,
  namePlaceholder,
  descriptionLabel,
  descriptionPlaceholder,
  saveLabel,
  cancelLabel,
  initialName,
  initialDescription,
  saving = false,
  onSave,
}: EditEntityDialogProps) {
  const [name, setName] = React.useState(initialName);
  const [descValue, setDescValue] = React.useState(initialDescription);

  React.useEffect(() => {
    if (open) {
      setName(initialName);
      setDescValue(initialDescription);
    }
  }, [open, initialName, initialDescription]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <label className="text-sm font-medium">{nameLabel}</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={namePlaceholder}
            />
          </div>
          <div className="grid gap-1.5">
            <label className="text-sm font-medium">{descriptionLabel}</label>
            <Textarea
              value={descValue}
              onChange={(e) => setDescValue(e.target.value)}
              rows={3}
              placeholder={descriptionPlaceholder}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            onClick={() => {
              void onSave({ name, description: descValue });
            }}
            disabled={saving || name.trim() === ""}
          >
            {saveLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
