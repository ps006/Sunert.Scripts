/*
本脚本用于中青看点极速版获取阅读数据及自动刷阅读得青豆、刷阅读时长得奖励，仅适用NE工具，因为脚本中有持久化操作

注意：去重排序模式是为了优化刷阅读任务的效率（单个有效视频数据阅读次数上限大，将其排前面，在循环阅读时有更多机会执行；移除中青判断为重复的数据，让阅读数据首次执行时获得更高奖励及避免循环阅读时因达到上限无法获得奖励，浪费一次阅读时间间隔的执行机会）

------------------------ QX ------------------------
[task_local]
# 凌晨1点到6点，每30秒执行一次【跑阅读及时长任务】
6/30 * 1-5 * * * https://raw.githubusercontent.com/ztxtop/Sunert.Scripts/master/Task/zqread.js, tag=中青阅读, img-url=https://raw.githubusercontent.com/Orz-3/task/master/youth.png, enabled=true

[rewrite_local]
# 获取阅读所需数据：今日内未获得过阅读奖励（当天阅读次数较多时，再去阅读将较频繁提示达到上限），配置好此重写规则，进入app阅读文章视频，每个文章视频只抓取首次奖励即可换下一个文章视频（单个文章视频的非首次的奖励可通过脚本循环跑时获得）
https?://ios\.baertt\.com/v5/article/complete url script-request-body https://raw.githubusercontent.com/ztxtop/Sunert.Scripts/master/Task/zqread.js
# 获取阅读时长数据：如果跑一次阅读脚本，阅读时长未增加1分钟或以上，建议重新获取阅读时长数据，因为部分文章的阅读时长数据才几秒或十几秒，这得猴年马月才能获得阅读60分钟的800青豆奖励
https?://ios\.baertt\.com/v5/user/app_stay\.json url script-request-body https://raw.githubusercontent.com/ztxtop/Sunert.Scripts/master/Task/zqread.js
# 获取签到所需数据
https?://\w+\.youth\.cn/TaskCenter/(sign|getSign) url script-request-header https://raw.githubusercontent.com/ztxtop/Sunert.Scripts/master/Task/zqread.js
# 获取惊喜红包所需数据
https?://ios\.baertt\.com/v5/article/red_packet url script-request-body https://raw.githubusercontent.com/ztxtop/Sunert.Scripts/master/Task/zqread.js

[mitm]
hostname = *.youth.cn, ios.baertt.com

------------------------ Loon ------------------------
[Script]
# 凌晨1点到6点，每30秒执行一次【跑阅读及时长任务】
cron "6/30 * 1-5 * * *" script-path=https://raw.githubusercontent.com/ztxtop/Sunert.Scripts/master/Task/zqread.js, enabled=true, tag=中青自动阅读
http-request https?://ios\.baertt\.com/v5/article/complete script-path=https://raw.githubusercontent.com/ztxtop/Sunert.Scripts/master/Task/zqread.js, requires-body=1
http-request https?://ios\.baertt\.com/v5/user/app_stay\.json script-path=https://raw.githubusercontent.com/ztxtop/Sunert.Scripts/master/Task/zqread.js, requires-body=1
http-request https?://\w+\.youth\.cn/TaskCenter/(sign|getSign) script-path=https://raw.githubusercontent.com/ztxtop/Sunert.Scripts/master/Task/zqread.js, requires-body=1
http-request https?://ios\.baertt\.com/v5/article/red_packet script-path=https://raw.githubusercontent.com/ztxtop/Sunert.Scripts/master/Task/zqread.js, requires-body=1

[MITM]
hostname = *.youth.cn, ios.baertt.com

*/

const $ = new Env(`中青自动阅读`);
$.idx = ($.idx = ($.getval('zqSuffix') || '0') - 0) - 1 > 0 ? ($.idx + '') : ''; // 账号扩展字符
$.nowTime = new Date().getTime();
$.isRewrite = 'undefined' !== typeof $request;
$.isResponse = 'undefined' !== typeof $response;
$.isTask = `undefined` === typeof $request;

let readtimeKey = `readtime_zq`; // 阅读时长数据key
let nextReadTimeKey = `next_read_time`; // 达到阅读时长基线时，将明天凌晨0点0分的时间戳记录下来，执行阅读时长时，当前时间戳小于此值则不执行时长任务
let redKey = `red_zq`; // 惊喜红包数据key
let signKey = `youthheader_zq`; // 签到数据key
let mainKey = `read_zq`; // 阅读数据key
let numKey = `read_pre_num`; // 上条阅读数据序号
let countKey = `read_count`; // 阅读数据总记录数
let lastReplacedNo = `replaceable_idx`; // 最后一条视频数据序号
let nextExecReadTimeKey = `next_exec_read_time`; // 下次最快可执行的时间戳，当前时间戳大于此值时，方可执行任务

let removeReqData = false; // 是否清除缓存, true则开启
let cycle = true; // 阅读的完最后一条后，是否再从头阅读, 不循环阅读且最大阅读次数为2时，第二次阅读青豆低于10将提示
const readMode = ($.getval('readMode') || '0') - 0; // 0-普通任务模式、1-去重排序模式（视频数据排前，首次奖励小于等于10则判定为二次处理，需移除）、2-跑去重模式前，重置标识数据、3-打印QX持久化数据代码，用于备份阅读数据

!(async () => {
    if ($.isRewrite) { // 重写请求截取数据
        await getRequestBody();
    } else if ($.isTask) { // 定时任务处理
        $.zqCount = ($.zqCount = ($.getval('zqCount') || '0') - 0) - 1 > 0 ? $.zqCount : 1; // 执行任务的账号个数
        for (let index = 0; index < $.zqCount; index++) {
            $.idx = index ? (index + 1 + '') : '';
            countKey = `read_count${$.idx}`; // 阅读数据总记录数
            let count = ($.getval(countKey) || 0) - 0;
            if (!count) {
                continue;
            }
            if (readMode === 3) {
                let allData = [];
                $.scheme = $.getval('zqReadScheme') || '';
                for (let i = 1; i <= count; i++) {
                    const data = $.getval(mainKey + $.idx + '_' + i);
                    if (data) {
                        switch ($.scheme) {
                            case 'QX': {
                                allData.push(`$prefs.setValueForKey('${data}', '${mainKey+$.idx}_${i}');`);
                                break;
                            };
                            case 'LS': {
                                allData.push(`$persistentStore.write('${data}', '${mainKey+$.idx}_${i}');`);
                                break;
                            };
                            case 'GA': {
                                allData.push(data);
                                break;
                            };
                            default: {
                                if ($.isQuanX) {
                                    allData.push(`$prefs.setValueForKey('${data}', '${mainKey+$.idx}_${i}');`);
                                } else {
                                    allData.push(`$persistentStore.write('${data}', '${mainKey+$.idx}_${i}');`);
                                }
                            }
                        }
                    }
                }
                if (allData.length > 0) {
                    const videoNo = Math.max(0, ($.getval(lastReplacedNo + $.idx) || '0') - 0);
                    switch ($.scheme) {
                        case 'QX': {
                            allData.push(`$prefs.setValueForKey('${videoNo}', '${lastReplacedNo+$.idx}');`);
                            allData.push(`$prefs.setValueForKey('${count}', '${countKey}');`);
                            break;
                        };
                        case 'LS': {
                            allData.push(`$persistentStore.write('${videoNo}', '${lastReplacedNo+$.idx}');`);
                            allData.push(`$persistentStore.write('${count}', '${countKey}');`);
                            break;
                        };
                        case 'GA': {
                            allData = [allData.join('&')];
                            break;
                        };
                        default: {
                            if ($.isQuanX) {
                                allData.push(`$prefs.setValueForKey('${videoNo}', '${lastReplacedNo+$.idx}');`);
                                allData.push(`$prefs.setValueForKey('${count}', '${countKey}');`);
                            } else {
                                allData.push(`$persistentStore.write('${videoNo}', '${lastReplacedNo+$.idx}');`);
                                allData.push(`$persistentStore.write('${count}', '${countKey}');`);
                            }
                        }
                    }
                    $.log('', ...allData, '');
                } else {
                    $.log('', `${$.name + $.idx}暂无阅读数据`, '');
                }
            } else if (readMode === 2) {
                $.log('', `移除上条任务处理序号：${$.getval(numKey+$.idx)}`, `移除最后的视频序号：${$.getval(lastReplacedNo+$.idx)}`, '');
                $.setval('', numKey + $.idx);
                $.setval('', lastReplacedNo + $.idx);
                if ($.getval('readMode')) {
                    $.setval('1', 'readMode');
                    $.msg($.name + $.idx, ``, `🎉已切换到去重排序模式：${$.time('yyyy-MM-dd qq HH:mm:ss.S')}`);
                }
            } else {
                // 去重模式不能循环跑任务
                cycle = readMode != 1 && cycle;
                await Promise.all([
                    execReadTime(),
                    execRead()
                ]);
            }
        }
    }
})().catch((e) => $.logErr(e)).finally(() => $.done());
function getRequestBody() {
    return new Promise((resolve) => {
        let subt = '重写数据';
        try {
            if ($request && $request.method != 'OPTIONS' && $request.url.match(/\/article\/complete/)) {
                subt = '新增阅读数据';
                let count = ($.getval(countKey + $.idx) || 0) - 0 + 1;
                $.setval($request.body, mainKey + $.idx + '_' + count);
                let currNum = ($.getval(numKey + $.idx) || 0) - 0 + 1;
                let tips = `新增第${count}条阅读数据，下次阅读第${currNum}条数据`;
                $.msg($.name + $.idx, subt, tips);
                $.setval(count + '', countKey + $.idx);
            } else if ($request && $request.method != 'OPTIONS' && $request.url.match(/\/v5\/user\/app_stay/)) {
                subt = '获取阅读时长数据';
                $.setval($request.body, readtimeKey + $.idx);
                let tips = `🎉获取阅读时长数据成功；如果时间增长慢，请重新获取`;
                $.msg($.name + $.idx, subt, tips);
            } else if ($request && $request.method != 'OPTIONS' && $request.url.match(/\/article\/red_packet/)) {
                subt = '获取惊喜红包数据';
                $.setval($request.body, redKey + $.idx);
                let tips = `🎉获取惊喜红包数据成功`;
                $.msg($.name + $.idx, subt, tips);
            } else if ($request && $request.method != 'OPTIONS' && $request.url.match(/\/TaskCenter\/(sign|getSign)/)) {
                subt = '获取签到数据';
                $.setval(JSON.stringify($request.headers), signKey + $.idx);
                let tips = `🎉获取签到数据成功`;
                $.msg($.name + $.idx, '', tips);
            }
        } catch (e) {
            $.msg($.name + $.idx, `${subt}处理异常`, `原因: ${e}`);
        } finally {
            resolve();
        }
    });
}

function execReadTime() {
    return new Promise(resolve => {
        let timebodyVal = $.getval(readtimeKey + $.idx);
        let nextReadTime = ($.getval(nextReadTimeKey + $.idx) || 0) - 0;
        if (!timebodyVal || $.nowTime < nextReadTime) {
            resolve();
            return;
        }
        const opts = {
            url: `https://ios.baertt.com/v5/user/stay.json`,
            headers: {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
            },
            body: timebodyVal
        }
        $.post(opts, (error, response, data) => {
            try {
                const obj = JSON.parse(data);
                if (obj['error_code'] == 0) {
                    $.log('', `【阅读时长】共计` + Math.floor(obj.time / 60) + `分钟`, '');
                    if (obj.time >= Math.floor(Math.random() * (7200 - 9000) + 9000)) {
                        // 时长达2小时+，设置下次执行时间需大于明天凌晨
                        let nextTime = new Date();
                        nextTime.setHours(0);
                        nextTime.setMinutes(0);
                        $.setval((nextTime.getTime() + 24 * 60 * 60 * 1000) + '', nextReadTimeKey + $.idx);
                    }
                } else if (obj['error_code'] == 200001) {
                    $.log('', `【阅读时长】❎ 统计失败，原因: 未获取阅读时长Cookie`, '');
                } else {
                    $.log('', `【阅读时长】❎ 统计失败，原因: ${obj.msg}`, '');
                }
            } catch (e) {
                $.log('', `【阅读时长】❎ 统计异常，原因: ${e}`, `响应数据: ${data}`, '');
            } finally {
                resolve();
            }
        });
    });
}

function execRead() {
    return new Promise((resolve) => {
        try {
            let count = ($.getval(countKey) || 0) - 0;
            if (removeReqData) {
                if (count > 0) {
                    for (let i = 1; i <= count; i++) {
                        $.setval('', mainKey + $.idx + '_' + i);
                    }
                    $.setval('', numKey + $.idx);
                    $.setval('', countKey);
                    $.setval('', lastReplacedNo + $.idx);
                    $.msg($.name + $.idx, "清空数据成功", '请手动关闭脚本内"removeReqData"选项');
                } else {
                    $.msg($.name + $.idx, "清空脚本终止", '未关闭脚本内"removeReqData"选项 ‼️');
                }
                resolve();
            } else {
                if (count <= 0) {
                    $.msg($.name + $.idx, "脚本终止", '暂无阅读数据！');
                    resolve();
                } else {
                    let data = '';
                    do {
                        let currNum = ($.getval(numKey + $.idx) || 0) - 0 + 1;
                        if ($.time('yyyy-MM-dd') != $.getval(`execDay${$.idx}`)) {
                            // 今日未执行阅读任务，重置阅读位置
                            currNum = 1;
                            $.setval('', numKey + $.idx);
                            $.setval($.time('yyyy-MM-dd'), `execDay${$.idx}`);
                            $.log('', `😄今日首次执行阅读的时间：${$.time('yyyy-MM-dd qq HH:mm:ss.S')}`, '');
                        }
                        if (cycle && count > 0) {
                            currNum = currNum > count ? 1 : currNum;
                        } else if (currNum > count) {
                            if (readMode && $.getval('readMode')) {
                                $.msg($.name + $.idx, `视频数据：${($.getval(lastReplacedNo + $.idx) || '0') - 0}条`, `⚠️【${currNum}/${count}】去重阅读任务已全部执行完：${$.time('yyyy-MM-dd qq HH:mm:ss.S')}`);
                            }
                            data = 'done';
                            break;
                        }
                        data = $.getval(mainKey + $.idx + '_' + currNum);
                        if (data) {
                            let nextExecTime = ($.getval(nextExecReadTimeKey + $.idx) || 0) - 0;
                            if (nextExecTime <= $.nowTime) {
                                if (currNum == 1) {
                                    $.msg($.name + $.idx, ``, `🎉新一轮阅读任务(${($.getval(lastReplacedNo + $.idx) || '0') - 0}/${count})开始：${$.time('yyyy-MM-dd qq HH:mm:ss.S')}`);
                                }
                                // 记录下次最快执行时间为21秒之后
                                $.setval(($.nowTime + 21000) + '', nextExecReadTimeKey + $.idx);
                                const opts = {
                                    url: `https://ios.baertt.com/v5/article/complete.json`,
                                    headers: {
                                        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
                                    },
                                    body: data,
                                }
                                const dataBak = data;
                                $.post(opts, async (error, response, resData) => {
                                    try {
                                        if (resData) {
                                            let updateFlag = false;
                                            let obj = JSON.parse(resData);
                                            let readScore = obj.items && obj.items['read_score'];
                                            if (readScore > 0) {
                                                updateFlag = true;
                                                if (readMode) {
                                                    // 去重排序模式，移除首次执行奖励小于等于10的任务，奖励大于10的视频任务需尝试往前排
                                                    if (readScore <= 10) {
                                                        transfer(currNum, count, 0);
                                                    } else if (obj.items['ctype'] == 3) { // ctype=0是阅读数据
                                                        // 视频数据，尝试前移
                                                        transfer(currNum, count, 1);
                                                    }
                                                }
                                                // 前20个阅读领激励视频奖励,其实只能领15次
                                                if (currNum <= 20 && readScore >= 20) await gameVideo(dataBak);
                                                $.log('', `😄【${currNum}/${count}】${obj.items['ctype']}阅读任务获取青豆奖励：${readScore}`, '');
                                            } else if (readScore == 0) {
                                                if (readMode) {
                                                    $.msg($.name + $.idx, '', `⚠️【${currNum}/${count}】${obj.items['ctype']}阅读任务未获取到青豆奖励，移除当前阅读数据`);
                                                    transfer(currNum, count, 0);
                                                } else {
                                                    // 该阅读已达今日领取上限，根据情况决策是否设置下次执行任务的位置或时间
                                                    updateFlag = true;
                                                    const videoNo = ($.getval(lastReplacedNo + $.idx) || 0) - 0;
                                                    if (videoNo > 0 && obj.items['ctype'] == 3 && obj.items['max_video'] == 1) {
                                                        // 视频任务达上限，切换到文章任务序号，待下次执行
                                                        const articleNo = Math.max(1, videoNo + 1);
                                                        $.log('', `❤️【${currNum}/${count}】视频任务已达今日奖励上限，下次执行文章阅读任务位置：${articleNo}`, '');
                                                        currNum = articleNo > currNum ? articleNo - 1 : currNum;
                                                    } else if (videoNo > 0 && obj.items['ctype'] == 0 && obj.items['max_article'] == 1) {
                                                        // 文章任务达上限，切换到视频任务序号，待下次执行
                                                        $.log('', `❤️【${currNum}/${count}】文章任务已达今日奖励上限，下次执行视频阅读任务位置：1`, '');
                                                        currNum = 0;
                                                    } else if (obj.items['max_notice'] == '\u4eca\u65e5\u9605\u8bfb\u5230\u4e0a\u9650\u5566\uff0c\u53bb\u4efb\u52a1\u4e2d\u5fc3\u7ee7\u7eed\u8d5a\u9752\u8c46\u5427') {
                                                        // 今日阅读到上限啦，去任务中心继续赚青豆吧
                                                        $.msg($.name + $.idx, '', `⚠️【${currNum}/${count}】${obj.items['max_notice']}`);
                                                        // 阅读达每日上限，设置第二天才能调用阅读接口
                                                        let nextTime = new Date($.nowTime);
                                                        nextTime.setHours(0);
                                                        nextTime.setMinutes(0);
                                                        $.setval((nextTime.getTime() + 24 * 60 * 60 * 1000) + '', nextExecReadTimeKey + $.idx);
                                                    } else {
                                                        $.log('', `😒【${currNum}/${count}】${obj.items['ctype']}阅读任务未获取到青豆奖励，进入下一个阅读任务`, '');
                                                    }
                                                }
                                            } else {
                                                if (!obj.items) {
                                                    updateFlag = !readMode;
                                                    $.msg($.name + $.idx, `【${currNum}/${count}】阅读出现未知情况`, resData);
                                                } else {
                                                    $.msg($.name + $.idx, '', `⚠️⚠️⚠️【${currNum}/${count}】任务执行时间间隔过小导致获取不到青豆奖励值，请检查是否有其它地方在运行该账号的阅读任务`);
                                                }
                                            }
                                            if (updateFlag) {
                                                // 记录当前阅读任务序号，以便下次任务可执行下一个阅读任务
                                                $.setval(currNum + '', numKey + $.idx);
                                            }
                                        } else {
                                            $.log('', `【${currNum}/${count}】❎ 请求无响应体数据: ${resData}`, '');
                                        }
                                    } catch (e) {
                                        $.log('', `【${currNum}/${count}】❎ 执行异常，原因: ${e}`, '');
                                    } finally {
                                        resolve();
                                    }
                                });
                            } else {
                                let tips = '任务执行时间间隔过小，请检查是否有其它地方在运行该账号的阅读任务';
                                if ($.time('yyyy-MM-dd') != changeDateFormat(nextExecTime).substr(0, 10)) {
                                    tips = '今日阅读到上限啦，去任务中心继续赚青豆吧';
                                }
                                $.log('', `⚠️⚠️⚠️【${currNum}/${count}】❎ ${tips}`, `下次最早可执行时间: ${changeDateFormat(nextExecTime)}`, `视频记录数：${($.getval(lastReplacedNo + $.idx) || '0') - 0}`, '');
                                resolve();
                            }
                            data = '';
                        } else {
                            $.msg($.name + $.idx, '', `【${currNum}/${count}】待处理数据不存在，移动最后一条数据到此处后再重试`);
                            transfer(currNum, count, '');
                            data = 'retry';
                            count--;
                        }
                    } while (data && count > 0);
                    if (data) {
                        resolve();
                    }
                }
            }
        } catch (e) {
            resolve();
            $.log('', `${$.name+$.idx}异常，原因: ${e}`, '');
        }
    });
}

function transfer(currNum, count, flag) {
    if (!flag) {
        if (flag === 0) {
            $.log('', `【${currNum}/${count}】移除的重复数据: \n${$.getval(mainKey+$.idx + '_' + currNum)}`, '');
        }
        // 当前位置数据为空或判定为重复数据，移动最后一个数据到当前位置，等待下次执行
        if (currNum < count) {
            const lastNode = $.getval(mainKey + $.idx + '_' + count);
            $.setval(lastNode, mainKey + $.idx + '_' + currNum);
        }
        $.setval('', mainKey + $.idx + '_' + count);
        $.setval((count > 1 ? count - 1 : 0) + '', countKey);
    } else if (currNum > 0) {
        // 当前位置数据为视频类型，尝试将其迁移到前面，如果前面全是视频类型的数据，则仅更新视频记录数
        const videoNo = Math.max(1, ($.getval(lastReplacedNo + $.idx) || '0') - 0 + 1);
        if (videoNo < currNum) {
            $.log('', `${$.name+$.idx}任务排序：➡️😊 第${currNum}条任务为视频数据，与第${videoNo}条任务交换位置`, '');
            // 获取待交换位置的两个数据，并执行替换
            const currData = $.getval(mainKey + $.idx + '_' + currNum);
            const swapNode = $.getval(mainKey + $.idx + '_' + videoNo);
            $.setval(currData, mainKey + $.idx + '_' + videoNo);
            $.setval(swapNode, mainKey + $.idx + '_' + currNum);
        }
        // 保存最后一个视频数据的序号
        $.setval(Math.min(videoNo, currNum) + '', lastReplacedNo + $.idx);
    } else {
        $.msg($.name + $.idx, '任务排序', `🤔️ 待前移的任务数据的序号小于1？：${currNum}`);
    }
}

// 激励视频奖励
function gameVideo(bodyVal) {
    return new Promise((resolve, reject) => {
        const url = {
            url: `https://ios.baertt.com/v5/Game/GameVideoReward.json`,
            body: bodyVal,
        }
        $.post(url, (error, response, data) => {
            $.log('', `【激励视频】${data}`, '');
            resolve();
        })
    })
}

/**
 * 格式化时间戳
 * @param {待格式化的时间戳} time 
 */
function changeDateFormat(time) {
    const date = new Date(time);
    const month = date.getMonth() + 1 < 10 ? "0" + (date.getMonth() + 1) : date.getMonth() + 1;
    const currentDate = date.getDate() < 10 ? "0" + date.getDate() : date.getDate();
    return date.getFullYear() + "-" + month + "-" + currentDate + " " + date.toTimeString().substr(0, 8);
  }

function Env(t,e){class s{constructor(t){this.env=t}send(t,e="GET"){t="string"==typeof t?{url:t}:t;let s=this.get;return"POST"===e&&(s=this.post),new Promise((e,i)=>{s.call(this,t,(t,s,r)=>{t?i(t):e(s)})})}get(t){return this.send.call(this.env,t)}post(t){return this.send.call(this.env,t,"POST")}}return new class{constructor(t,e){this.name=t,this.http=new s(this),this.data=null,this.dataFile="box.dat",this.logs=[],this.isMute=!1,this.isNeedRewrite=!1,this.logSeparator="\n",this.startTime=(new Date).getTime(),Object.assign(this,e),this.log("",`\ud83d\udd14${this.name}, \u5f00\u59cb!`)}isNode(){return"undefined"!=typeof module&&!!module.exports}isQuanX(){return"undefined"!=typeof $task}isSurge(){return"undefined"!=typeof $httpClient&&"undefined"==typeof $loon}isLoon(){return"undefined"!=typeof $loon}toObj(t,e=null){try{return JSON.parse(t)}catch{return e}}toStr(t,e=null){try{return JSON.stringify(t)}catch{return e}}getjson(t,e){let s=e;const i=this.getdata(t);if(i)try{s=JSON.parse(this.getdata(t))}catch{}return s}setjson(t,e){try{return this.setdata(JSON.stringify(t),e)}catch{return!1}}getScript(t){return new Promise(e=>{this.get({url:t},(t,s,i)=>e(i))})}runScript(t,e){return new Promise(s=>{let i=this.getdata("@chavy_boxjs_userCfgs.httpapi");i=i?i.replace(/\n/g,"").trim():i;let r=this.getdata("@chavy_boxjs_userCfgs.httpapi_timeout");r=r?1*r:20,r=e&&e.timeout?e.timeout:r;const[o,h]=i.split("@"),a={url:`http://${h}/v1/scripting/evaluate`,body:{script_text:t,mock_type:"cron",timeout:r},headers:{"X-Key":o,Accept:"*/*"}};this.post(a,(t,e,i)=>s(i))}).catch(t=>this.logErr(t))}loaddata(){if(!this.isNode())return{};{this.fs=this.fs?this.fs:require("fs"),this.path=this.path?this.path:require("path");const t=this.path.resolve(this.dataFile),e=this.path.resolve(process.cwd(),this.dataFile),s=this.fs.existsSync(t),i=!s&&this.fs.existsSync(e);if(!s&&!i)return{};{const i=s?t:e;try{return JSON.parse(this.fs.readFileSync(i))}catch(t){return{}}}}}writedata(){if(this.isNode()){this.fs=this.fs?this.fs:require("fs"),this.path=this.path?this.path:require("path");const t=this.path.resolve(this.dataFile),e=this.path.resolve(process.cwd(),this.dataFile),s=this.fs.existsSync(t),i=!s&&this.fs.existsSync(e),r=JSON.stringify(this.data);s?this.fs.writeFileSync(t,r):i?this.fs.writeFileSync(e,r):this.fs.writeFileSync(t,r)}}lodash_get(t,e,s){const i=e.replace(/\[(\d+)\]/g,".$1").split(".");let r=t;for(const t of i)if(r=Object(r)[t],void 0===r)return s;return r}lodash_set(t,e,s){return Object(t)!==t?t:(Array.isArray(e)||(e=e.toString().match(/[^.[\]]+/g)||[]),e.slice(0,-1).reduce((t,s,i)=>Object(t[s])===t[s]?t[s]:t[s]=Math.abs(e[i+1])>>0==+e[i+1]?[]:{},t)[e[e.length-1]]=s,t)}getdata(t){let e=this.getval(t);if(/^@/.test(t)){const[,s,i]=/^@(.*?)\.(.*?)$/.exec(t),r=s?this.getval(s):"";if(r)try{const t=JSON.parse(r);e=t?this.lodash_get(t,i,""):e}catch(t){e=""}}return e}setdata(t,e){let s=!1;if(/^@/.test(e)){const[,i,r]=/^@(.*?)\.(.*?)$/.exec(e),o=this.getval(i),h=i?"null"===o?null:o||"{}":"{}";try{const e=JSON.parse(h);this.lodash_set(e,r,t),s=this.setval(JSON.stringify(e),i)}catch(e){const o={};this.lodash_set(o,r,t),s=this.setval(JSON.stringify(o),i)}}else s=this.setval(t,e);return s}getval(t){return this.isSurge()||this.isLoon()?$persistentStore.read(t):this.isQuanX()?$prefs.valueForKey(t):this.isNode()?(this.data=this.loaddata(),this.data[t]):this.data&&this.data[t]||null}setval(t,e){return this.isSurge()||this.isLoon()?$persistentStore.write(t,e):this.isQuanX()?$prefs.setValueForKey(t,e):this.isNode()?(this.data=this.loaddata(),this.data[e]=t,this.writedata(),!0):this.data&&this.data[e]||null}initGotEnv(t){this.got=this.got?this.got:require("got"),this.cktough=this.cktough?this.cktough:require("tough-cookie"),this.ckjar=this.ckjar?this.ckjar:new this.cktough.CookieJar,t&&(t.headers=t.headers?t.headers:{},void 0===t.headers.Cookie&&void 0===t.cookieJar&&(t.cookieJar=this.ckjar))}get(t,e=(()=>{})){t.headers&&(delete t.headers["Content-Type"],delete t.headers["Content-Length"]),this.isSurge()||this.isLoon()?(this.isSurge()&&this.isNeedRewrite&&(t.headers=t.headers||{},Object.assign(t.headers,{"X-Surge-Skip-Scripting":!1})),$httpClient.get(t,(t,s,i)=>{!t&&s&&(s.body=i,s.statusCode=s.status),e(t,s,i)})):this.isQuanX()?(this.isNeedRewrite&&(t.opts=t.opts||{},Object.assign(t.opts,{hints:!1})),$task.fetch(t).then(t=>{const{statusCode:s,statusCode:i,headers:r,body:o}=t;e(null,{status:s,statusCode:i,headers:r,body:o},o)},t=>e(t))):this.isNode()&&(this.initGotEnv(t),this.got(t).on("redirect",(t,e)=>{try{if(t.headers["set-cookie"]){const s=t.headers["set-cookie"].map(this.cktough.Cookie.parse).toString();s&&this.ckjar.setCookieSync(s,null),e.cookieJar=this.ckjar}}catch(t){this.logErr(t)}}).then(t=>{const{statusCode:s,statusCode:i,headers:r,body:o}=t;e(null,{status:s,statusCode:i,headers:r,body:o},o)},t=>{const{message:s,response:i}=t;e(s,i,i&&i.body)}))}post(t,e=(()=>{})){if(t.body&&t.headers&&!t.headers["Content-Type"]&&(t.headers["Content-Type"]="application/x-www-form-urlencoded"),t.headers&&delete t.headers["Content-Length"],this.isSurge()||this.isLoon())this.isSurge()&&this.isNeedRewrite&&(t.headers=t.headers||{},Object.assign(t.headers,{"X-Surge-Skip-Scripting":!1})),$httpClient.post(t,(t,s,i)=>{!t&&s&&(s.body=i,s.statusCode=s.status),e(t,s,i)});else if(this.isQuanX())t.method="POST",this.isNeedRewrite&&(t.opts=t.opts||{},Object.assign(t.opts,{hints:!1})),$task.fetch(t).then(t=>{const{statusCode:s,statusCode:i,headers:r,body:o}=t;e(null,{status:s,statusCode:i,headers:r,body:o},o)},t=>e(t));else if(this.isNode()){this.initGotEnv(t);const{url:s,...i}=t;this.got.post(s,i).then(t=>{const{statusCode:s,statusCode:i,headers:r,body:o}=t;e(null,{status:s,statusCode:i,headers:r,body:o},o)},t=>{const{message:s,response:i}=t;e(s,i,i&&i.body)})}}time(t){let e={"M+":(new Date).getMonth()+1,"d+":(new Date).getDate(),"H+":(new Date).getHours(),"m+":(new Date).getMinutes(),"s+":(new Date).getSeconds(),"q+":Math.floor(((new Date).getMonth()+3)/3),S:(new Date).getMilliseconds()};/(y+)/.test(t)&&(t=t.replace(RegExp.$1,((new Date).getFullYear()+"").substr(4-RegExp.$1.length)));for(let s in e)new RegExp("("+s+")").test(t)&&(t=t.replace(RegExp.$1,1==RegExp.$1.length?e[s]:("00"+e[s]).substr((""+e[s]).length)));return t}msg(e=t,s="",i="",r){const o=t=>{if(!t)return t;if("string"==typeof t)return this.isLoon()?t:this.isQuanX()?{"open-url":t}:this.isSurge()?{url:t}:void 0;if("object"==typeof t){if(this.isLoon()){let e=t.openUrl||t.url||t["open-url"],s=t.mediaUrl||t["media-url"];return{openUrl:e,mediaUrl:s}}if(this.isQuanX()){let e=t["open-url"]||t.url||t.openUrl,s=t["media-url"]||t.mediaUrl;return{"open-url":e,"media-url":s}}if(this.isSurge()){let e=t.url||t.openUrl||t["open-url"];return{url:e}}}};if(this.isMute||(this.isSurge()||this.isLoon()?$notification.post(e,s,i,o(r)):this.isQuanX()&&$notify(e,s,i,o(r))),!this.isMuteLog){let t=["","==============\ud83d\udce3\u7cfb\u7edf\u901a\u77e5\ud83d\udce3=============="];t.push(e),s&&t.push(s),i&&t.push(i),console.log(t.join("\n")),this.logs=this.logs.concat(t)}}log(...t){t.length>0&&(this.logs=[...this.logs,...t]),console.log(t.join(this.logSeparator))}logErr(t,e){const s=!this.isSurge()&&!this.isQuanX()&&!this.isLoon();s?this.log("",`\u2757\ufe0f${this.name}, \u9519\u8bef!`,t.stack):this.log("",`\u2757\ufe0f${this.name}, \u9519\u8bef!`,t)}wait(t){return new Promise(e=>setTimeout(e,t))}done(t={}){const e=(new Date).getTime(),s=(e-this.startTime)/1e3;this.log("",`\ud83d\udd14${this.name}, \u7ed3\u675f! \ud83d\udd5b ${s} \u79d2`),this.log(),(this.isSurge()||this.isQuanX()||this.isLoon())&&$done(t)}}(t,e)}
