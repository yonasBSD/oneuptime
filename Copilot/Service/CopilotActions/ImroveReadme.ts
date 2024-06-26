import CopilotActionType from "Common/Types/Copilot/CopilotActionType";
import CopilotActionBase, {
  CopilotActionPrompt,
  CopilotProcess,
  PromptRole,
} from "./CopilotActionsBase";
import CodeRepositoryUtil from "../../Utils/CodeRepository";

export default class ImproveReadme extends CopilotActionBase {
  public constructor() {
    super();
    this.copilotActionType = CopilotActionType.IMRPOVE_README;
    this.acceptFileExtentions = CodeRepositoryUtil.getReadmeFileExtentions();
  }

  public override async getPrompt(
    _data: CopilotProcess,
  ): Promise<CopilotActionPrompt> {
    const prompt: string = `Please improve this readme.

    If you think the readme is already well commented, please reply with the following text:
    --all-good--
    
    Here is the readme content. This is in {{fileLanguage}}: 
    
    {{code}}
                `;

    const systemPrompt: string = `You are an expert programmer. Here are your instructions:
- You will follow the instructions given by the user strictly.
- You will not deviate from the instructions given by the user.
- You will not change the code unnecessarily. For example you will not change the code structure, logic, quotes around strings, or functionality.`;

    return {
      messages: [
        {
          content: systemPrompt,
          role: PromptRole.System,
        },
        {
          content: prompt,
          role: PromptRole.User,
        },
      ],
    };
  }
}
