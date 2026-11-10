"use client";
import { CHECKLIST_ITEM_KINDS, SUGGESTED_SKILLS } from "@fieldops/shared";
import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Controller, useFieldArray, type UseFormReturn } from "react-hook-form";
import { FieldError } from "@/components/app/field-error";
import { NativeSelect } from "@/components/app/native-select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FormInput, FormOutput } from "./service-type-dialog";

/** Skills a technician needs for this service type (SCH-03 warns when an assignee lacks one). */
export function SkillsEditor({
  idPrefix,
  value,
  onChange,
}: {
  idPrefix: string;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const t = useTranslations("fieldwork.template");
  const [draft, setDraft] = useState("");
  const add = (skill: string) => {
    const s = skill.trim().toLowerCase();
    if (!s || value.includes(s) || value.length >= 10) return;
    onChange([...value, s]);
    setDraft("");
  };
  const suggestions = SUGGESTED_SKILLS.filter((s) => !value.includes(s));
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{t("skills")}</legend>
      <p className="text-muted-foreground text-xs">{t("skillsHint")}</p>
      {value.length ? (
        <ul className="flex flex-wrap gap-1.5" aria-label={t("skills")}>
          {value.map((s) => (
            <li key={s} className="bg-secondary inline-flex items-center gap-1 rounded-full py-0.5 pr-1 pl-2.5 text-xs">
              {s}
              <button
                type="button"
                className="hover:bg-background rounded-full p-0.5"
                aria-label={t("removeSkill", { skill: s })}
                onClick={() => onChange(value.filter((x) => x !== s))}
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex gap-2">
        <Input
          id={`${idPrefix}-skill`}
          aria-label={t("addSkill")}
          placeholder={t("skillPlaceholder")}
          maxLength={40}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(draft);
            }
          }}
        />
        <Button type="button" variant="outline" onClick={() => add(draft)} disabled={!draft.trim()}>
          {t("add")}
        </Button>
      </div>
      {suggestions.length ? (
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <Button key={s} type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => add(s)}>
              <Plus className="size-3" /> {s}
            </Button>
          ))}
        </div>
      ) : null}
    </fieldset>
  );
}

/** The checklist template copied into each new job of this service type (JOB-08). */
export function ChecklistTemplateEditor({
  idPrefix,
  form,
}: {
  idPrefix: string;
  form: UseFormReturn<FormInput, unknown, FormOutput>;
}) {
  const t = useTranslations("fieldwork.template");
  const { fields, append, remove, move } = useFieldArray({ control: form.control, name: "checklist_template" });
  const errors = form.formState.errors.checklist_template;
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">{t("checklist")}</legend>
      <p className="text-muted-foreground text-xs">{t("checklistHint")}</p>
      {fields.length ? (
        <ol className="space-y-3">
          {fields.map((field, i) => {
            const kind = form.watch(`checklist_template.${i}.kind`) ?? "checkbox";
            const base = `${idPrefix}-item-${i}`;
            return (
              <li key={field.id} className="space-y-2 rounded-md border p-3" data-testid="template-item">
                <div className="flex items-start gap-2">
                  <span className="text-muted-foreground mt-2 w-5 text-right text-xs tabular-nums">{i + 1}.</span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <Label htmlFor={`${base}-label`} className="sr-only">
                      {t("itemLabel", { n: i + 1 })}
                    </Label>
                    <Input
                      id={`${base}-label`}
                      placeholder={t("labelPlaceholder")}
                      aria-invalid={Boolean(errors?.[i]?.label)}
                      {...form.register(`checklist_template.${i}.label`)}
                    />
                    <FieldError message={errors?.[i]?.label?.message} />
                  </div>
                  <div className="flex">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={i === 0}
                      aria-label={t("moveUp", { n: i + 1 })}
                      onClick={() => move(i, i - 1)}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={i === fields.length - 1}
                      aria-label={t("moveDown", { n: i + 1 })}
                      onClick={() => move(i, i + 1)}
                    >
                      <ArrowDown />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("remove", { n: i + 1 })}
                      onClick={() => remove(i)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3 pl-7">
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`${base}-kind`} className="text-xs">
                      {t("kindLabel")}
                    </Label>
                    <NativeSelect id={`${base}-kind`} className="w-36" {...form.register(`checklist_template.${i}.kind`)}>
                      {CHECKLIST_ITEM_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {t(`kind.${k}`)}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                  {kind === "number" ? (
                    <div className="flex items-center gap-2">
                      <Label htmlFor={`${base}-unit`} className="text-xs">
                        {t("unit")}
                      </Label>
                      <Input
                        id={`${base}-unit`}
                        className="h-9 w-24"
                        maxLength={20}
                        placeholder="°F"
                        {...form.register(`checklist_template.${i}.unit`)}
                      />
                    </div>
                  ) : null}
                  <Controller
                    control={form.control}
                    name={`checklist_template.${i}.required`}
                    render={({ field: f }) => (
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id={`${base}-required`}
                          checked={Boolean(f.value)}
                          onCheckedChange={(v) => f.onChange(v === true)}
                        />
                        <Label htmlFor={`${base}-required`} className="text-xs">
                          {t("required")}
                        </Label>
                      </div>
                    )}
                  />
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={fields.length >= 50}
        onClick={() => append({ label: "", kind: "checkbox", unit: "", required: true })}
      >
        <Plus /> {t("addItem")}
      </Button>
    </fieldset>
  );
}
