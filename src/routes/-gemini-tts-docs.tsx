import { Accordion, Anchor, Typography } from "@mantine/core";
import { IconBook } from "@tabler/icons-react";
import type { ComponentPropsWithoutRef } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import doc from "../../docs/gemini-tts.md?raw";

function MarkdownLink({ href, children }: ComponentPropsWithoutRef<"a">) {
  return (
    <Anchor href={href} target="_blank" rel="noreferrer">
      {children}
    </Anchor>
  );
}

const markdownComponents: Components = { a: MarkdownLink };

/** Renders the Gemini 3.1 Flash TTS reference (docs/gemini-tts.md) inline in the
 *  TTS playground, in a collapsed accordion so it stays out of the way. */
export function GeminiTtsDocs() {
  return (
    <Accordion variant="separated" radius="md">
      <Accordion.Item value="gemini-tts">
        <Accordion.Control icon={<IconBook size={16} />}>
          Gemini 3.1 Flash TTS — expressions & API reference
        </Accordion.Control>
        <Accordion.Panel>
          <Typography>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {doc}
            </ReactMarkdown>
          </Typography>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}
