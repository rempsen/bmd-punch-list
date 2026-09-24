import { useSignedUrls } from "@/lib/photos";
import { cn } from "@/lib/utils";
import { ImageOff } from "lucide-react";

export function PhotoThumb({
  path,
  className,
  alt = "Deficiency photo",
}: {
  path?: string | null;
  className?: string;
  alt?: string;
}) {
  const { data } = useSignedUrls(path ? [path] : []);
  const url = path ? data?.[path] : undefined;

  if (!url) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-md bg-muted text-muted-foreground",
          className,
        )}
      >
        <ImageOff className="h-4 w-4" />
      </div>
    );
  }
  return <img src={url} alt={alt} className={cn("rounded-md object-cover", className)} />;
}
