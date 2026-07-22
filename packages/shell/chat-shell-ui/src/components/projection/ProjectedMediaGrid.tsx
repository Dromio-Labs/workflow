import type { ChatMessage } from "../../packages/chatshell-response-protocol";

import { InlineMediaImage } from "./InlineMediaImage";
import { InlineMediaVideo } from "./InlineMediaVideo";

export function ProjectedMediaGrid({
	className,
	imageClassName,
	media,
}: {
	className: string;
	imageClassName: string;
	media: ChatMessage["media"];
}) {
	if (media.length === 0) return null;
	return (
		<div className={className}>
			{media.map((item) => {
				if (item.mediaType.startsWith("image/")) {
					return <InlineMediaImage className={imageClassName} item={item} key={item.fileId} />;
				}
				if (item.mediaType.startsWith("video/")) {
					return <InlineMediaVideo item={item} key={item.fileId} />;
				}
				return null;
			})}
		</div>
	);
}
