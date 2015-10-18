var config = require('config');
var async = require('async');
var request = require('request');
var qs = require('qs');

function compareLikes(postOne, postTwo) {
    return postTwo.likes.count - postOne.likes.count;
}

function getAttachmentsStr(attachments) {
    var attachmentsStr = '';
    attachments.forEach(function(item, i) {
        if (attachmentsStr.length > 0){
            attachmentsStr = attachmentsStr + ',';
        }
        if (item.type == 'link') {
            attachmentsStr = attachmentsStr + item[item.type].url;
        } else {
            attachmentsStr = attachmentsStr + item.type + item[item.type].owner_id + '_' + item[item.type].id; 
        }
    });
    return attachmentsStr;
}

function requestAPI(reqMethod, apiMethod, data, callback) {
    request({
        method: reqMethod,
        timeout: 5000,
        uri: 'https://api.vk.com/method/' + apiMethod + '?v=5.37&access_token=' + config.vk.token + '&' + qs.stringify(data)
    }, function(err, res, body) {
        if (err) {
            return callback(err);
        }
        callback(null, JSON.parse(body));
    });
}

// Get the last added post time
requestAPI('GET', 'wall.get', { 'owner_id' : config.vk.targetGroupId, 'offset' : 0, 'count' : 1}, function(err, post) {

    if (err) {
        console.log('GET ERROR:', err);
        return;
    }

    if (!post.response.items.length) {
        return;
    }

    var lastPostAddTime = post.response.items[0].date;
    console.log(lastPostAddTime);

    async.eachSeries(config.vk.pullGroupIds, function(groupId, nextGroup) {
        //get set of posts from targeted group that were added after last post from my group (up to 50)
        requestAPI('GET', 'wall.get', {'owner_id' : groupId, 'offset' : 1, 'count' : 50}, function(err, posts) {

            if (err) {
                return nextGroup(err);
            }

            var postsArr = posts.response.items;
            var currPostTime = 0;

            var postsToAdd = postsArr.filter(function(post) {
                return post.date > lastPostAddTime;
            });

            if (!postsToAdd.length) {
                console.log('nothing to add');
                return;
            }

            console.log('last post was added at: ' + currPostTime + ', amount of post is: ' + postsToAdd.length);

            postsToAdd.sort(function(postOne, postTwo) {
                return postTwo.likes.count - postOne.likes.count;
            });


            var totalLikes = postsToAdd.reduce(function(last, next) {
                return last += next.likes.count;
            }, 0);

            console.log('TOTAL LIKES:', totalLikes);

            var postsLikesProportion = postsToAdd.map(function(post, i) {
                return { id: i, likesProportion: 100 * post.likes.count / totalLikes, count: post.likes.count };
            });

            async.eachSeries(postsToAdd.slice(0, 5), function(post, next) {

                var attachmentsStr = getAttachmentsStr(post.attachments);

                console.log('POST ID:', post.id);

                requestAPI('POST', 'wall.post', {
                    owner_id: config.vk.targetGroupId,
                    from_group: 1,
                    message: postsArr[0].text,
                    attachments: attachmentsStr
                }, function(err) {

                    if (err) {
                        console.log('POST ERROR:', err);
                    }

                    setTimeout(next, 1000);
                });

            }, function(err) {
                if (err) {
                    console.log('POST ERROR:', err);
                    nextGroup(err);
                    return;
                }

                console.log('GROUP DONE!!!');
                nextGroup();
            });
        });
    }, function(err) {
        if (err) {
            console.log('GROUP ERROR:', err);
            return;
        }

        console.log('GROUPS DONE!!!');
    }); 
});