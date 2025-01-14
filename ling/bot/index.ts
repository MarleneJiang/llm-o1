import EventEmitter from 'node:events';
import type OpenAI from 'openai';
import { Tube } from "../tube";
import nunjucks from 'nunjucks';
import { getChatCompletions } from "../adapter/openai";

import type { ChatConfig, ChatOptions } from "../types";
import type { ChatCompletionAssistantMessageParam, ChatCompletionSystemMessageParam, ChatCompletionUserMessageParam } from "openai/resources/index";

type ChatCompletionMessageParam = ChatCompletionSystemMessageParam | ChatCompletionAssistantMessageParam | ChatCompletionUserMessageParam;

export enum WorkState {
  INIT = 'init',
  WORKING = 'chatting',
  FINISHED = 'finished',
  ERROR = 'error',
}

export abstract class Bot extends EventEmitter {
  abstract get state(): WorkState;
}

export class ChatBot extends Bot {
  private prompts: ChatCompletionSystemMessageParam[] = [];
  private history: ChatCompletionMessageParam[] = [];
  private customParams: Record<string, string> = {};
  private chatState = WorkState.INIT;

  constructor(private tube: Tube, private client: OpenAI, private config: ChatConfig, private options: ChatOptions = {}) {
    super();
  }

  setJSONRoot(root: string | null) {
    if (!this.options.response_format) {
      this.options.response_format = { type: 'json_object', root };
    } else {
      this.options.response_format.root = root;
    }
  }

  setCustomParams(params: Record<string, string>) {
    this.customParams = { ...params };
  }

  addPrompt(promptTpl: string, promptData: Record<string, any> = {}) {
    const promptText = nunjucks.renderString(promptTpl, { chatConfig: this.config, chatOptions: this.options, ...this.customParams, ...promptData, });
    this.prompts.push({ role: "system", content: promptText });
  }

  setPrompt(promptTpl: string, promptData: Record<string, string> = {}) {
    this.prompts = [];
    this.addPrompt(promptTpl, promptData);
  }

  addHistory(messages: ChatCompletionMessageParam[]) {
    this.history.push(...messages);
  }

  setHistory(messages: ChatCompletionMessageParam[]) {
    this.history = messages;
  }

  addFilter(filter: ((data: unknown) => boolean) | string | RegExp) {
    this.tube.addFilter(filter);
  }

  clearFilters() {
    this.tube.clearFilters();
  }

  userMessage(message: string): ChatCompletionUserMessageParam {
    return { role: "user", content: message };
  }

  botMessage(message: string): ChatCompletionAssistantMessageParam {
    return { role: "assistant", content: message };
  }

  async chat(message: string) {
    try {
      this.chatState = WorkState.WORKING;
      const prompts = this.prompts.length > 0 ? [...this.prompts] : [];
      const messages = [...prompts, ...this.history, { role: "user", content: message }];
      return await getChatCompletions(this.tube, messages, this.client, this.config, this.options,
        (content) => { // on complete
          this.chatState = WorkState.FINISHED;
          this.emit('response', content);
        }, (content) => { // on string response
          this.emit('string-response', content);
        }).then((content) => {
          this.emit('inference-done', content);
        });
    } catch (ex: any) {
      console.error(ex);
      this.chatState = WorkState.ERROR;
      // this.emit('error', ex.message);
      this.tube.enqueue({ event: 'error', data: ex.message });
      // this.tube.cancel();
    }
  }

  get state() {
    return this.chatState;
  }
}