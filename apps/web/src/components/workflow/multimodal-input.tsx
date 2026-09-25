"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRightIcon, FileTextIcon, ImageIcon, MicIcon, TypeIcon } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useMemo } from "react";
import { Controller, useForm } from "react-hook-form";

import { AudioRecorder } from "@/components/inputs/audio-recorder";
import { FileDropzone } from "@/components/inputs/file-dropzone";
import { FilePreviewList } from "@/components/inputs/file-preview-list";
import { ImageUpload } from "@/components/inputs/image-upload";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { makeInputSchema, type InputFormValues } from "@/lib/workflow/schema";
import type { InputMode, WorkflowConfig, WorkflowInput } from "@/lib/workflow/types";

const MODES: Record<InputMode, { label: string; icon: LucideIcon }> = {
  text: { label: "Text", icon: TypeIcon },
  file: { label: "File", icon: FileTextIcon },
  image: { label: "Image", icon: ImageIcon },
  audio: { label: "Voice", icon: MicIcon },
};

const AUDIO_ACCEPT = ["audio/*"];

/**
 * One form for text + files + images + voice. All attachments land in a single `files` list, so
 * the workflow engine treats every mode the same. Driven entirely by `config.input`.
 */
export function MultimodalInput({
  config,
  defaultValues,
  onSubmit,
}: {
  config: WorkflowConfig<unknown>["input"];
  defaultValues?: WorkflowInput | null;
  onSubmit: (input: WorkflowInput) => void;
}) {
  const schema = useMemo(
    () => makeInputSchema({ maxFiles: config.maxFiles, maxFileMb: config.maxFileMb }),
    [config.maxFiles, config.maxFileMb],
  );
  const form = useForm<InputFormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultValues ?? { text: "", files: [] },
  });
  const files = form.watch("files");
  const text = form.watch("text");

  const addFiles = (next: File[]) =>
    form.setValue("files", [...files, ...next], { shouldValidate: true, shouldDirty: true });
  const images = files.filter((f) => f.type.startsWith("image/"));

  const submit = form.handleSubmit((v) => onSubmit({ text: v.text, files: v.files }));
  const errors = form.formState.errors;

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <Card>
        <CardContent>
          <Tabs defaultValue={config.modes[0]} className="gap-5">
            {config.modes.length > 1 && (
              <TabsList className="w-full sm:w-fit">
                {config.modes.map((m) => {
                  const { label, icon: Icon } = MODES[m];
                  return (
                    <TabsTrigger key={m} value={m} className="px-2 sm:px-3">
                      <Icon aria-hidden className="max-[359px]:hidden" /> {label}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            )}

            <TabsContent value="text">
              <Field data-invalid={!!errors.text}>
                <FieldLabel htmlFor="wf-text">{config.textLabel}</FieldLabel>
                <Textarea
                  id="wf-text"
                  rows={7}
                  placeholder={config.textPlaceholder}
                  aria-invalid={!!errors.text}
                  className="max-h-[50vh]"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
                  }}
                  {...form.register("text")}
                />
                <div className="flex items-start justify-between gap-4">
                  <FieldError errors={[errors.text]} />
                  <span className="ml-auto shrink-0 text-footnote text-muted-foreground tabular-nums">
                    {text.length.toLocaleString()} chars
                  </span>
                </div>
              </Field>
              {config.examples && config.examples.length > 0 && (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <span className="text-footnote text-muted-foreground">Try:</span>
                  {config.examples.map((ex) => (
                    <Button
                      key={ex.label}
                      type="button"
                      variant="secondary"
                      size="xs"
                      className="rounded-full"
                      onClick={() => form.setValue("text", ex.text, { shouldValidate: true })}
                    >
                      {ex.label}
                    </Button>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="file">
              <FileDropzone
                accept={config.accept}
                onFiles={addFiles}
                title="Drop documents or click to browse"
                hint={`PDF, text, and more · up to ${config.maxFileMb} MB each`}
              />
            </TabsContent>

            <TabsContent value="image">
              <Controller
                control={form.control}
                name="files"
                render={({ field }) => (
                  <ImageUpload
                    value={images}
                    showPreviews={false}
                    max={config.maxFiles}
                    onChange={(nextImages) =>
                      field.onChange([
                        ...field.value.filter((f) => !f.type.startsWith("image/")),
                        ...nextImages,
                      ])
                    }
                  />
                )}
              />
            </TabsContent>

            <TabsContent value="audio" className="flex flex-col gap-3">
              <AudioRecorder onRecorded={(f) => addFiles([f])} />
              <FileDropzone
                accept={AUDIO_ACCEPT}
                onFiles={addFiles}
                title="Or upload an audio file"
                hint="MP3, WAV, M4A, OGG"
                className="py-6"
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {files.length > 0 && (
        <section aria-label="Attached files" className="flex flex-col gap-2">
          <p className="text-footnote font-medium text-muted-foreground">
            Attached · {files.length}/{config.maxFiles}
          </p>
          <FilePreviewList
            files={files}
            onRemove={(i) =>
              form.setValue(
                "files",
                files.filter((_, j) => j !== i),
                { shouldValidate: true },
              )
            }
          />
          <FieldError errors={Array.isArray(errors.files) ? errors.files : [errors.files]} />
        </section>
      )}

      <div className="flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="hidden text-footnote text-muted-foreground sm:block">
          Press Ctrl/⌘ + Enter to submit
        </p>
        <Button type="submit" size="lg" className="sm:min-w-44">
          {config.submitLabel}
          <ArrowRightIcon data-icon="inline-end" />
        </Button>
      </div>
    </form>
  );
}
