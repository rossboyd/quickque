import { useState } from "react";
import { useCreateAdminLicence, getGetAdminLicencesQueryKey, getGetAdminSummaryQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Copy, AlertTriangle, Check, X } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

const formSchema = z.object({
  email: z.string().email("Invalid email address"),
  source: z.string().min(1, "Source is required"),
  plan: z.string().min(1, "Plan is required"),
  paidThrough: z.string().optional(),
  note: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

export function CreateLicenceDialog() {
  const [open, setOpen] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createLicence = useCreateAdminLicence();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: "",
      source: "gift",
      plan: "perpetual",
      paidThrough: "",
      note: "",
    },
  });

  const source = form.watch("source");
  const onSubmit = (values: FormValues) => {
    const normalized = {
      ...values,
      plan: values.source === "gift" ? "perpetual" : "subscription",
      paidThrough: values.source === "tester" && values.paidThrough
        ? new Date(values.paidThrough).toISOString()
        : null,
      note: values.note || null,
    };
    createLicence.mutate(
      { data: normalized },
      {
        onSuccess: (data) => {
          setCreatedKey(data.licenceKey);
          queryClient.invalidateQueries({ queryKey: getGetAdminLicencesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetAdminSummaryQueryKey() });
          toast({ title: "Licence created successfully" });
        },
        onError: () => {
          toast({ title: "Failed to create licence", variant: "destructive" });
        }
      }
    );
  };

  const handleCopy = () => {
    if (createdKey) {
      navigator.clipboard.writeText(createdKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleClose = (newOpen: boolean) => {
    if (!newOpen) {
      // Only close if not showing the key
      if (!createdKey) {
        setOpen(false);
        form.reset();
      }
    } else {
      setOpen(true);
    }
  };

  const forceClose = () => {
    setOpen(false);
    setTimeout(() => {
      setCreatedKey(null);
      form.reset();
    }, 300);
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleClose}>
      <DialogPrimitive.Trigger asChild>
        <button className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground h-10 px-4 text-sm font-medium hover:bg-primary/90 transition-colors">
          <Plus className="h-4 w-4" />
          Issue Licence
        </button>
      </DialogPrimitive.Trigger>
      
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] border border-border bg-card p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]">
          
          {createdKey ? (
            <div className="space-y-6">
              <div>
                <DialogPrimitive.Title className="text-lg font-semibold leading-none tracking-tight">
                  Licence Key Generated
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="text-sm text-muted-foreground mt-2">
                  This raw key is shown exactly once. Please copy and store it securely.
                </DialogPrimitive.Description>
              </div>

              <div className="bg-destructive/10 border border-destructive/20 p-4 flex items-start gap-3 text-destructive">
                <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-semibold mb-1">Important</p>
                  <p>We do not store the raw key in the database. If lost, a new licence must be issued.</p>
                </div>
              </div>

              <div className="flex gap-2">
                <div className="flex-1 bg-muted p-3 border border-border font-mono text-sm break-all">
                  {createdKey}
                </div>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="bg-primary text-primary-foreground px-4 flex items-center justify-center hover:bg-primary/90 transition-colors shrink-0"
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>

              <div className="flex justify-end pt-4 border-t border-border">
                <button
                  type="button"
                  onClick={forceClose}
                  className="bg-foreground text-background h-10 px-4 text-sm font-medium hover:bg-foreground/90 transition-colors"
                >
                  I have copied the key
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <DialogPrimitive.Title className="text-lg font-semibold leading-none tracking-tight">
                    Issue New Licence
                  </DialogPrimitive.Title>
                  <DialogPrimitive.Description className="text-sm text-muted-foreground mt-1.5">
                    Manually provision a new licence key for a user.
                  </DialogPrimitive.Description>
                </div>
                <DialogPrimitive.Close className="h-8 w-8 inline-flex items-center justify-center rounded-sm opacity-70 transition-opacity hover:opacity-100 hover:bg-muted text-muted-foreground">
                  <X className="h-4 w-4" />
                </DialogPrimitive.Close>
              </div>

              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="email" className="text-sm font-medium leading-none">Email Address</label>
                  <input
                    id="email"
                    {...form.register("email")}
                    className="flex h-10 w-full border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary focus-visible:border-primary disabled:cursor-not-allowed disabled:opacity-50 font-mono"
                    placeholder="user@example.com"
                  />
                  {form.formState.errors.email && (
                    <p className="text-[13px] text-destructive font-medium">{form.formState.errors.email.message}</p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label htmlFor="plan" className="text-sm font-medium leading-none">Plan</label>
                    <select
                      id="plan"
                      disabled
                      value={source === "gift" ? "perpetual" : "subscription"}
                      className="flex h-10 w-full border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary font-mono"
                    >
                       {source === "gift"
                         ? <option value="perpetual">Lifetime</option>
                         : <option value="subscription">Time-limited</option>}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="source" className="text-sm font-medium leading-none">Source</label>
                    <select
                      id="source"
                      {...form.register("source")}
                      className="flex h-10 w-full border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary font-mono"
                    >
                       <option value="gift">Gift</option>
                       <option value="tester">Tester</option>
                    </select>
                  </div>

                {source === "tester" && (
                  <div className="space-y-2">
                    <label htmlFor="paidThrough" className="text-sm font-medium leading-none">Access expires</label>
                    <input
                      id="paidThrough"
                      type="datetime-local"
                      {...form.register("paidThrough", { required: source === "tester" })}
                      className="flex h-10 w-full border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary font-mono"
                    />
                    <p className="text-xs text-muted-foreground">Tester licences must have a future expiry.</p>
                  </div>
                )}
                </div>

                <div className="space-y-2">
                  <label htmlFor="note" className="text-sm font-medium leading-none">Internal Note (Optional)</label>
                  <input
                    id="note"
                    {...form.register("note")}
                    className="flex h-10 w-full border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary font-mono"
                    placeholder="Reason for issuance..."
                  />
                </div>

                <div className="pt-4 flex justify-end gap-2 border-t border-border mt-6">
                  <DialogPrimitive.Close asChild>
                    <button
                      type="button"
                      className="h-10 px-4 text-sm font-medium border border-border bg-transparent hover:bg-muted transition-colors text-foreground"
                    >
                      Cancel
                    </button>
                  </DialogPrimitive.Close>
                  <button
                    type="submit"
                    disabled={createLicence.isPending}
                    className="h-10 px-4 text-sm font-medium bg-foreground text-background hover:bg-foreground/90 transition-colors disabled:opacity-50 inline-flex items-center"
                  >
                    {createLicence.isPending ? "Generating..." : "Generate Key"}
                  </button>
                </div>
              </form>
            </>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}