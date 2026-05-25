import { ScenePage } from '@/components/ScenePage'

export default function SceneLandingPage() {
  return (
    <ScenePage
      title="企业 AI 知识库"
      subtitle="让员工像问同事一样从公司文档里找到答案，秒级响应，答案可追溯"
      pains={[
        '文档分散在多个系统，查找耗时费力',
        '相同问题反复解答，占用大量人力',
        '新员工找不到资料，上手慢、易出错',
        '文档更新后，旧答案还在流通',
      ]}
      solutions={[
        '用自然语言提问，像问同事一样简单',
        '答案直接显示来源段落，可信可核查',
        '支持追问，一步步深入了解',
        '文档一更新，答案随即刷新',
      ]}
      highlights={[
        { icon: '⚡', label: '秒级响应' },
        { icon: '🔗', label: '引用定位' },
        { icon: '💬', label: '多轮追问' },
        { icon: '📂', label: '多格式文档' },
      ]}
    />
  )
}
