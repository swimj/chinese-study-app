const lookupTrials = [
  {
    "id": "kiosk-newsstand",
    "kind": "tap",
    "text": "河边那座旧报刊亭关了三年。",
    "start": 6,
    "end": 7,
    "intent": "Identify the newsstand as a single object. The next character 关 begins what happened to it.",
    "acceptableSpans": [
      "报刊亭"
    ],
    "results": [
      {
        "model": "CC-CEDICT",
        "ms": 0,
        "answer": {
          "span": "报刊亭",
          "pinyin": "bào kān tíng",
          "gloss": "newsstand"
        },
        "reason": "single-reading-and-gloss"
      },
      {
        "model": "google/gemini-3.5-flash-lite",
        "ms": 798,
        "answer": {
          "span": "报刊",
          "pinyin": "bào kān",
          "gloss": "newspapers and periodicals",
          "chunks": []
        }
      },
      {
        "model": "gpt-6.2-sol",
        "ms": 5505,
        "answer": {
          "span": "报刊亭",
          "pinyin": "bàokāntíng",
          "gloss": "newsstand; a kiosk selling newspapers and magazines",
          "chunks": []
        }
      }
    ]
  },
  {
    "id": "kiosk-still",
    "kind": "tap",
    "text": "玻璃上还贴着一张早已过期的订报广告。",
    "start": 3,
    "end": 4,
    "intent": "Read hái. The advertisement is still stuck to the glass.",
    "acceptableSpans": [
      "还",
      "还贴着"
    ],
    "results": [
      {
        "model": "CC-CEDICT",
        "ms": 0,
        "answer": null,
        "reason": "multiple-readings"
      },
      {
        "model": "google/gemini-3.5-flash-lite",
        "ms": 755,
        "answer": {
          "span": "还",
          "pinyin": "hái",
          "gloss": "still",
          "chunks": []
        }
      },
      {
        "model": "gpt-6.2-sol",
        "ms": 2397,
        "answer": {
          "span": "还",
          "pinyin": "hái",
          "gloss": "still (the ad is still up)",
          "chunks": []
        }
      }
    ]
  },
  {
    "id": "kiosk-return",
    "kind": "tap",
    "text": "没带伞就拿一把。有空了再还。",
    "start": 12,
    "end": 13,
    "intent": "Read huán. The implied object is the borrowed umbrella.",
    "acceptableSpans": [
      "还",
      "再还"
    ],
    "results": [
      {
        "model": "CC-CEDICT",
        "ms": 0,
        "answer": null,
        "reason": "multiple-readings"
      },
      {
        "model": "google/gemini-3.5-flash-lite",
        "ms": 747,
        "answer": {
          "span": "还",
          "pinyin": "hái",
          "gloss": "to return (an item)",
          "chunks": []
        }
      },
      {
        "model": "gpt-6.2-sol",
        "ms": 1825,
        "answer": {
          "span": "还",
          "pinyin": "huán",
          "gloss": "return it (the umbrella)",
          "chunks": []
        }
      }
    ]
  },
  {
    "id": "show-listening",
    "kind": "tap",
    "text": "我本来只想出去透透气，听着听着，也跟着唱了起来。",
    "start": 13,
    "end": 14,
    "intent": "The second 听 belongs to the repetition. Continued listening sets the scene for starting to sing along.",
    "acceptableSpans": [
      "听着听着",
      "听着"
    ],
    "results": [
      {
        "model": "CC-CEDICT",
        "ms": 0,
        "answer": null,
        "reason": "multiple-readings"
      },
      {
        "model": "google/gemini-3.5-flash-lite",
        "ms": 739,
        "answer": {
          "span": "听",
          "pinyin": "tīng",
          "gloss": "to listen",
          "chunks": []
        }
      },
      {
        "model": "gpt-6.2-sol",
        "ms": 4756,
        "answer": {
          "span": "听着听着",
          "pinyin": "tīngzhe tīngzhe",
          "gloss": "as I kept listening",
          "chunks": [
            "听着",
            "听着"
          ]
        }
      }
    ]
  },
  {
    "id": "kiosk-sew",
    "kind": "tap",
    "text": "说那是给我缝裤脚剩下的几颗扣子。",
    "start": 5,
    "end": 6,
    "intent": "Read féng. She stitched the trouser hems; these buttons were left over.",
    "acceptableSpans": [
      "缝",
      "缝裤脚"
    ],
    "results": [
      {
        "model": "CC-CEDICT",
        "ms": 0,
        "answer": null,
        "reason": "multiple-readings"
      },
      {
        "model": "google/gemini-3.5-flash-lite",
        "ms": 736,
        "answer": {
          "span": "缝",
          "pinyin": "féng",
          "gloss": "sew",
          "chunks": []
        }
      },
      {
        "model": "gpt-6.2-sol",
        "ms": 2341,
        "answer": {
          "span": "缝",
          "pinyin": "féng",
          "gloss": "to sew (here, to hem the pant legs)",
          "chunks": []
        }
      }
    ]
  },
  {
    "id": "kiosk-first-glance",
    "kind": "tap",
    "text": "深蓝，乍一看像黑的。",
    "start": 3,
    "end": 4,
    "intent": "At first glance the dark blue looks black. Give the relevant initial-impression sense.",
    "acceptableSpans": [
      "乍一看",
      "乍",
      "乍一看像黑的"
    ],
    "results": [
      {
        "model": "CC-CEDICT",
        "ms": 0,
        "answer": null,
        "reason": "multiple-or-missing-glosses"
      },
      {
        "model": "google/gemini-3.5-flash-lite",
        "ms": 743,
        "answer": {
          "span": "乍",
          "pinyin": "zhà",
          "gloss": "at first glance",
          "chunks": []
        }
      },
      {
        "model": "gpt-6.2-sol",
        "ms": 5552,
        "answer": {
          "span": "乍一看",
          "pinyin": "zhà yí kàn",
          "gloss": "at first glance",
          "chunks": []
        }
      }
    ]
  },
  {
    "id": "probe-study-life",
    "kind": "tap",
    "text": "我们研究生命的起源，也记录它的变化。",
    "start": 4,
    "end": 5,
    "intent": "研究 is the verb and 生命 begins its object. Explain life here.",
    "acceptableSpans": [
      "生命"
    ],
    "results": [
      {
        "model": "CC-CEDICT",
        "ms": 0,
        "answer": null,
        "reason": "competing-boundaries"
      },
      {
        "model": "google/gemini-3.5-flash-lite",
        "ms": 746,
        "answer": {
          "span": "生命",
          "pinyin": "shēng mìng",
          "gloss": "life",
          "chunks": []
        }
      },
      {
        "model": "gpt-6.2-sol",
        "ms": 2508,
        "answer": {
          "span": "生命",
          "pinyin": "shēngmìng",
          "gloss": "life (as in “the origin of life”)",
          "chunks": []
        }
      }
    ]
  },
  {
    "id": "probe-grad-student",
    "kind": "tap",
    "text": "我们系的研究生正在记录植物的变化。",
    "start": 6,
    "end": 7,
    "intent": "研究生 names the graduate students doing the recording.",
    "acceptableSpans": [
      "研究生"
    ],
    "results": [
      {
        "model": "CC-CEDICT",
        "ms": 0,
        "answer": null,
        "reason": "multiple-or-missing-glosses"
      },
      {
        "model": "google/gemini-3.5-flash-lite",
        "ms": 839,
        "answer": {
          "span": "研究生",
          "pinyin": "yánjiūshēng",
          "gloss": "graduate student",
          "chunks": []
        }
      },
      {
        "model": "gpt-6.2-sol",
        "ms": 1888,
        "answer": {
          "span": "研究生",
          "pinyin": "yánjiūshēng",
          "gloss": "graduate student",
          "chunks": []
        }
      }
    ]
  },
  {
    "id": "probe-duck",
    "kind": "tap",
    "text": "湖边有一只鸭，身后跟着三只小鸭。",
    "start": 5,
    "end": 6,
    "intent": "The first 鸭 is a standalone noun for the duck. 一只 counts it.",
    "acceptableSpans": [
      "鸭"
    ],
    "results": [
      {
        "model": "CC-CEDICT",
        "ms": 0,
        "answer": null,
        "reason": "multiple-or-missing-glosses"
      },
      {
        "model": "google/gemini-3.5-flash-lite",
        "ms": 743,
        "answer": {
          "span": "鸭",
          "pinyin": "yā",
          "gloss": "duck",
          "chunks": []
        }
      },
      {
        "model": "gpt-6.2-sol",
        "ms": 1953,
        "answer": {
          "span": "鸭",
          "pinyin": "yā",
          "gloss": "duck",
          "chunks": []
        }
      }
    ]
  },
  {
    "id": "probe-screwdriver",
    "kind": "tap",
    "text": "消息里写着“🔧请带上螺丝刀”。",
    "start": 12,
    "end": 13,
    "intent": "Identify the whole tool, a screwdriver. The emoji before the tap occupies two UTF-16 code units.",
    "acceptableSpans": [
      "螺丝刀"
    ],
    "results": [
      {
        "model": "CC-CEDICT",
        "ms": 0,
        "answer": {
          "span": "螺丝刀",
          "pinyin": "luó sī dāo",
          "gloss": "screwdriver"
        },
        "reason": "single-reading-and-gloss"
      },
      {
        "model": "google/gemini-3.5-flash-lite",
        "ms": 657,
        "answer": {
          "span": "螺丝",
          "pinyin": "luósī",
          "gloss": "screw",
          "chunks": []
        }
      },
      {
        "model": "gpt-6.2-sol",
        "ms": 2764,
        "answer": {
          "span": "螺丝刀",
          "pinyin": "luósīdāo",
          "gloss": "screwdriver",
          "chunks": []
        }
      }
    ]
  },
  {
    "id": "probe-cannot-eat",
    "kind": "tap",
    "text": "她急得饭都吃不下。",
    "start": 6,
    "end": 7,
    "intent": "吃不下 expresses being unable to eat or get food down because she is anxious.",
    "acceptableSpans": [
      "吃不下"
    ],
    "results": [
      {
        "model": "CC-CEDICT",
        "ms": 0,
        "answer": null,
        "reason": "multiple-or-missing-glosses"
      },
      {
        "model": "google/gemini-3.5-flash-lite",
        "ms": 947,
        "answer": {
          "span": "吃不下",
          "pinyin": "chī bu xià",
          "gloss": "too upset or full to eat",
          "chunks": []
        }
      },
      {
        "model": "gpt-6.2-sol",
        "ms": 2651,
        "answer": {
          "span": "吃不下",
          "pinyin": "chī bu xià",
          "gloss": "can't manage to eat (here, because she's so anxious)",
          "chunks": []
        }
      }
    ]
  },
  {
    "id": "probe-surname",
    "kind": "tap",
    "text": "这位师傅姓单，大家都叫他单师傅。",
    "start": 5,
    "end": 6,
    "intent": "Read Shàn, the surname. The first occurrence follows 姓.",
    "acceptableSpans": [
      "单",
      "姓单"
    ],
    "results": [
      {
        "model": "CC-CEDICT",
        "ms": 0,
        "answer": null,
        "reason": "multiple-readings"
      },
      {
        "model": "google/gemini-3.5-flash-lite",
        "ms": 727,
        "answer": {
          "span": "单",
          "pinyin": "shàn",
          "gloss": "a Chinese surname",
          "chunks": []
        }
      },
      {
        "model": "gpt-6.2-sol",
        "ms": 3067,
        "answer": {
          "span": "单",
          "pinyin": "Shàn",
          "gloss": "Shan (a surname)",
          "chunks": []
        }
      }
    ]
  },
  {
    "id": "probe-ticket",
    "kind": "selection",
    "text": "上车前，请拿好车票。",
    "start": 7,
    "end": 9,
    "intent": "A ticket for the journey. An exact lexical gloss suffices.",
    "acceptableSpans": [
      "车票"
    ],
    "results": [
      {
        "model": "CC-CEDICT",
        "ms": 0,
        "answer": {
          "span": "车票",
          "pinyin": "chē piào",
          "gloss": "ticket for a bus or train"
        },
        "reason": "single-reading-and-gloss"
      },
      {
        "model": "google/gemini-3.5-flash-lite",
        "ms": 710,
        "answer": {
          "span": "车票",
          "pinyin": "chēpiào",
          "gloss": "ticket",
          "chunks": []
        }
      },
      {
        "model": "gpt-6.2-sol",
        "ms": 2510,
        "answer": {
          "span": "车票",
          "pinyin": "chēpiào",
          "gloss": "ticket for the ride",
          "chunks": []
        }
      }
    ]
  },
  {
    "id": "probe-concrete-tool",
    "kind": "selection",
    "text": "修抽屉时，我找了半天才找到螺丝刀。",
    "start": 13,
    "end": 16,
    "intent": "A screwdriver. A concise whole-word gloss suffices.",
    "acceptableSpans": [
      "螺丝刀"
    ],
    "results": [
      {
        "model": "CC-CEDICT",
        "ms": 0,
        "answer": {
          "span": "螺丝刀",
          "pinyin": "luó sī dāo",
          "gloss": "screwdriver"
        },
        "reason": "single-reading-and-gloss"
      },
      {
        "model": "google/gemini-3.5-flash-lite",
        "ms": 803,
        "answer": {
          "span": "螺丝刀",
          "pinyin": "luósīdāo",
          "gloss": "screwdriver",
          "chunks": []
        }
      },
      {
        "model": "gpt-6.2-sol",
        "ms": 2062,
        "answer": {
          "span": "螺丝刀",
          "pinyin": "luósīdāo",
          "gloss": "screwdriver",
          "chunks": []
        }
      }
    ]
  },
  {
    "id": "probe-play",
    "kind": "selection",
    "text": "轮到她弹这首曲子了。",
    "start": 3,
    "end": 4,
    "intent": "Read tán and gloss playing the piece on an instrument. Keep just the selected character.",
    "acceptableSpans": [
      "弹"
    ],
    "results": [
      {
        "model": "CC-CEDICT",
        "ms": 0,
        "answer": null,
        "reason": "multiple-readings"
      },
      {
        "model": "google/gemini-3.5-flash-lite",
        "ms": 764,
        "answer": {
          "span": "弹",
          "pinyin": "tán",
          "gloss": "to play (a musical instrument, such as a piano)",
          "chunks": []
        }
      },
      {
        "model": "gpt-6.2-sol",
        "ms": 2085,
        "answer": {
          "span": "弹",
          "pinyin": "tán",
          "gloss": "to play (a piece of music on an instrument)",
          "chunks": []
        }
      }
    ]
  },
  {
    "id": "probe-clever-saying",
    "kind": "selection",
    "text": "他自作主张改了报价，结果聪明反被聪明误。",
    "start": 12,
    "end": 19,
    "intent": "Explain how trying to be clever backfired. The proverb is useful as a unit; seven separate character glosses add little.",
    "acceptableSpans": [
      "聪明反被聪明误"
    ],
    "results": [
      {
        "model": "CC-CEDICT",
        "ms": 0,
        "answer": {
          "span": "聪明反被聪明误",
          "pinyin": "cōng míng fǎn bèi cōng míng wù",
          "gloss": "(idiom) a clever person may become the victim of his own ingenuity; cleverness may overreach itself; too smart for one's own good"
        },
        "reason": "single-reading-and-gloss"
      },
      {
        "model": "google/gemini-3.5-flash-lite",
        "ms": 753,
        "answer": {
          "span": "聪明反被聪明误",
          "pinyin": "cōng míng fǎn bèi cōng míng wù",
          "gloss": "to be too clever by half and suffer for it",
          "chunks": []
        }
      },
      {
        "model": "gpt-6.2-sol",
        "ms": 2117,
        "answer": {
          "span": "聪明反被聪明误",
          "pinyin": "cōngming fǎn bèi cōngming wù",
          "gloss": "He outsmarted himself: his own cleverness backfired.",
          "chunks": []
        }
      }
    ]
  },
  {
    "id": "probe-idiom",
    "kind": "selection",
    "text": "最后那段解释反而让人误会，真是画蛇添足。",
    "start": 15,
    "end": 19,
    "intent": "An unnecessary addition spoils the result. A literal image is useful only if it helps convey that point.",
    "acceptableSpans": [
      "画蛇添足"
    ],
    "results": [
      {
        "model": "CC-CEDICT",
        "ms": 0,
        "answer": null,
        "reason": "multiple-or-missing-glosses"
      },
      {
        "model": "google/gemini-3.5-flash-lite",
        "ms": 809,
        "answer": {
          "span": "画蛇添足",
          "pinyin": "huà shé tiān zú",
          "gloss": "ruining something by adding unnecessary details",
          "chunks": []
        }
      },
      {
        "model": "gpt-6.2-sol",
        "ms": 2258,
        "answer": {
          "span": "画蛇添足",
          "pinyin": "huà shé tiān zú",
          "gloss": "to spoil something by adding what wasn’t needed",
          "chunks": []
        }
      }
    ]
  },
  {
    "id": "probe-long-noun",
    "kind": "selection",
    "text": "山路上停着一辆公共汽车。",
    "start": 7,
    "end": 11,
    "intent": "Simply a bus. The four-character length alone does not warrant internal segmentation.",
    "acceptableSpans": [
      "公共汽车"
    ],
    "results": [
      {
        "model": "CC-CEDICT",
        "ms": 0,
        "answer": {
          "span": "公共汽车",
          "pinyin": "gōng gòng qì chē",
          "gloss": "bus"
        },
        "reason": "single-reading-and-gloss"
      },
      {
        "model": "google/gemini-3.5-flash-lite",
        "ms": 741,
        "answer": {
          "span": "公共汽车",
          "pinyin": "gōng gòng qì chē",
          "gloss": "bus",
          "chunks": []
        }
      },
      {
        "model": "gpt-6.2-sol",
        "ms": 1914,
        "answer": {
          "span": "公共汽车",
          "pinyin": "gōnggòng qìchē",
          "gloss": "bus",
          "chunks": []
        }
      }
    ]
  },
  {
    "id": "show-two-actions",
    "kind": "selection",
    "text": "我本来只想出去透透气，听着听着，也跟着唱了起来。",
    "start": 11,
    "end": 23,
    "intent": "Explain the transition from ongoing listening to beginning to sing along. 听着听着, 跟着, and 唱了起来 are useful groupings.",
    "acceptableSpans": [
      "听着听着，也跟着唱了起来"
    ],
    "results": [
      {
        "model": "CC-CEDICT",
        "ms": 0,
        "answer": null,
        "reason": "no-exact-entry"
      },
      {
        "model": "google/gemini-3.5-flash-lite",
        "ms": 871,
        "answer": {
          "span": "听着听着，也跟着唱了起来",
          "pinyin": "tīng zhe tīng zhe, yě gēn zhe chàng le qǐ lái",
          "gloss": "listening on and on, I also started singing along",
          "chunks": [
            "听着听着，",
            "也跟着",
            "唱了起来"
          ]
        }
      },
      {
        "model": "gpt-6.2-sol",
        "ms": 2460,
        "answer": {
          "span": "听着听着，也跟着唱了起来",
          "pinyin": "tīngzhe tīngzhe, yě gēnzhe chàng le qǐlái",
          "gloss": "As I kept listening, I started singing along too.",
          "chunks": [
            "听着听着，",
            "也跟着唱了起来"
          ]
        }
      }
    ]
  },
  {
    "id": "kiosk-result",
    "kind": "selection",
    "text": "青绿色的铁皮被雨冲得发白，玻璃上还贴着一张早已过期的订报广告。",
    "start": 0,
    "end": 12,
    "intent": "Rain washed the blue-green sheet metal pale. Show how 被 introduces what affected it and 得发白 gives the result.",
    "acceptableSpans": [
      "青绿色的铁皮被雨冲得发白"
    ],
    "results": [
      {
        "model": "CC-CEDICT",
        "ms": 0,
        "answer": null,
        "reason": "no-exact-entry"
      },
      {
        "model": "google/gemini-3.5-flash-lite",
        "ms": 1094,
        "answer": {
          "span": "青绿色的铁皮被雨冲得发白",
          "pinyin": "qīng lǜ sè de tiě pí bèi yǔ chōng de fǎ bái",
          "gloss": "the greenish sheet metal is washed pale by the rain",
          "chunks": [
            "青绿色的铁皮",
            "被雨冲得",
            "发白"
          ]
        }
      },
      {
        "model": "gpt-6.2-sol",
        "ms": 3480,
        "answer": {
          "span": "青绿色的铁皮被雨冲得发白",
          "pinyin": "qīnglǜsè de tiěpí bèi yǔ chōng de fābái",
          "gloss": "The rain had washed the blue-green sheet metal until it looked whitish. 被雨 marks what did it, and 得发白 gives the result.",
          "chunks": [
            "青绿色的铁皮",
            "被雨冲",
            "得发白"
          ]
        }
      }
    ]
  },
  {
    "id": "probe-cross-boundary",
    "kind": "selection",
    "text": "我们研究生命的起源，也记录它的变化。",
    "start": 3,
    "end": 5,
    "intent": "Respect 究生 as the selection. Explain that it straddles 研究 and 生命, without inventing a lexical meaning for the fragment.",
    "acceptableSpans": [
      "究生"
    ],
    "results": [
      {
        "model": "CC-CEDICT",
        "ms": 0,
        "answer": null,
        "reason": "no-exact-entry"
      },
      {
        "model": "google/gemini-3.5-flash-lite",
        "ms": 778,
        "answer": {
          "span": "究生",
          "pinyin": "jiū shēng",
          "gloss": "the second half of 研究生 (graduate student)",
          "chunks": []
        }
      },
      {
        "model": "gpt-6.2-sol",
        "ms": 2366,
        "answer": {
          "span": "究生",
          "pinyin": "jiū shēng",
          "gloss": "This crosses a word boundary: 究 ends 研究 (“study”), and 生 starts 生命 (“life”).",
          "chunks": []
        }
      }
    ]
  },
  {
    "id": "probe-second-return",
    "kind": "selection",
    "text": "借的伞还没还，我明天就送回去。",
    "start": 5,
    "end": 6,
    "intent": "This second 还 is huán, return the umbrella. Earlier 还 is hái in 还没.",
    "acceptableSpans": [
      "还"
    ],
    "results": [
      {
        "model": "CC-CEDICT",
        "ms": 0,
        "answer": null,
        "reason": "multiple-readings"
      },
      {
        "model": "google/gemini-3.5-flash-lite",
        "ms": 735,
        "answer": {
          "span": "还",
          "pinyin": "hái",
          "gloss": "still (yet to be returned)",
          "chunks": []
        }
      },
      {
        "model": "gpt-6.2-sol",
        "ms": 1621,
        "answer": {
          "span": "还",
          "pinyin": "huán",
          "gloss": "to return (the borrowed umbrella)",
          "chunks": []
        }
      }
    ]
  },
  {
    "id": "probe-reschedule",
    "kind": "selection",
    "text": "她提议把会议推迟到周五，好让大家都有时间准备。",
    "start": 3,
    "end": 11,
    "intent": "把 identifies the meeting being moved and 到周五 gives the new time. Explain the phrase as a rescheduling action.",
    "acceptableSpans": [
      "把会议推迟到周五"
    ],
    "results": [
      {
        "model": "CC-CEDICT",
        "ms": 0,
        "answer": null,
        "reason": "no-exact-entry"
      },
      {
        "model": "google/gemini-3.5-flash-lite",
        "ms": 759,
        "answer": {
          "span": "把会议推迟到周五",
          "pinyin": "bǎ huìyì tuīchí dào zhōuwǔ",
          "gloss": "to postpone the meeting to Friday",
          "chunks": []
        }
      },
      {
        "model": "gpt-6.2-sol",
        "ms": 3112,
        "answer": {
          "span": "把会议推迟到周五",
          "pinyin": "bǎ huìyì tuīchí dào zhōuwǔ",
          "gloss": "Postpone the meeting until Friday. 把 marks the meeting as what’s being moved; 到 introduces the new date.",
          "chunks": [
            "把会议",
            "推迟到周五"
          ]
        }
      }
    ]
  },
  {
    "id": "probe-finally",
    "kind": "selection",
    "text": "我好不容易挤上了最后一班车。",
    "start": 1,
    "end": 5,
    "intent": "Only after considerable effort or difficulty. Teach the conventional whole expression in context.",
    "acceptableSpans": [
      "好不容易"
    ],
    "results": [
      {
        "model": "CC-CEDICT",
        "ms": 0,
        "answer": null,
        "reason": "multiple-or-missing-glosses"
      },
      {
        "model": "google/gemini-3.5-flash-lite",
        "ms": 695,
        "answer": {
          "span": "好不容易",
          "pinyin": "hǎo bù róng yì",
          "gloss": "with a great deal of difficulty",
          "chunks": []
        }
      },
      {
        "model": "gpt-6.2-sol",
        "ms": 2422,
        "answer": {
          "span": "好不容易",
          "pinyin": "hǎo bù róngyì",
          "gloss": "only after much effort; I just managed to squeeze onto the last bus",
          "chunks": []
        }
      }
    ]
  }
];
