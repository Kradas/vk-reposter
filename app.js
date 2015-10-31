var config = require('config');
var async = require('async');
var request = require('request');
var qs = require('qs');
var firebase = require('firebase');

var database = new firebase(config.vk.firebaseLink);

function getAttachmentsStr(attachments) {
    var attachmentsStr = '';
    var likna = ''
    var flag = 0;
    if ('link' in attachments) {
        linka = linka + attachments[attachments.type].url;
    }
    attachments.forEach(function(item, i) {
        if (attachmentsStr.length > 0) {
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

function postsToRepost(postsToAdd) {

    //sorting by likes
    postsToAdd.sort(function(postOne, postTwo) {
        return postTwo.likes.count - postOne.likes.count;
    });

    //define total amount of likes
    var totalLikes = postsToAdd.reduce(function(last, next) {
        return last += next.likes.count;
    }, 0);

    //proportion for each post in total likes
    var postsLikesProportion = postsToAdd.map(function(post, i) {
        return { id: i + 1, likesProportion: 100 * post.likes.count / totalLikes, count: post.likes.count };
    });

    for (var i = postsLikesProportion.length - 2; postsLikesProportion[i]; i--) {
        postsLikesProportion[i].likesProportion += postsLikesProportion[i + 1].likesProportion;
    }

    var numberOfPosts = postsLikesProportion.filter(function(percent) {
        return percent.likesProportion > 70;
    });

    return numberOfPosts.length > 10 ? 10 : numberOfPosts.length;
}


// Get the last added post time 
requestAPI('GET', 'wall.get', { owner_id : config.vk.targetGroupId, offset : 0, count : 1}, function(err, post) {

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
        requestAPI('GET', 'wall.get', {owner_id : groupId, offset : 1, count : 50}, function(err, posts) {

            if (err) {
                return nextGroup(err);
            }

            database.child(groupId.toString()).once('value', function (snapshot) {

                var lastAddedPostTime = 0;

                if (!snapshot.val()) {
                    database.child(groupId).set({lastAddedPostTime : 0});
                } else {
                    lastAddedPostTime = snapshot.val().lastAddedPostTime;
                }

                var postsToAdd = posts.response.items.filter(function(post) {
                    return post.date > lastAddedPostTime;
                });

                database.child(groupId).update({lastAddedPostTime : posts.response.items[0].date});

                if (!postsToAdd.length) {
                    console.log('nothing to add');
                    nextGroup();
                    return;
                }

                console.log('The last post was added at: ' + lastAddedPostTime + ', amount of post is: ' + postsToAdd.length);

                var numberOfPostsToPost = postsToRepost(postsToAdd);

                console.log(numberOfPostsToPost + ' posts will be added');

                async.eachSeries(postsToAdd.slice(0, numberOfPostsToPost), function(post, next) {

                    var attachmentsStr;

                    if (post.attachments) {
                        var attachmentsStr = getAttachmentsStr(post.attachments);
                    } else {
                        var attachmentsStr = '';
                    }

                    console.log('POST ID:', post.id);

                    requestAPI('POST', 'wall.post', {
                        owner_id: config.vk.targetGroupId,
                        from_group: 1,
                        message: post.text,
                        attachments: attachmentsStr,
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
            }, function (err) {
                console.log(err);
                process.exit();
            });
        });
    }, function(err) {
        if (err) {
            console.log('GROUP ERROR:', err);
            return;
        }

        console.log('GROUPS DONE!!!');
        process.exit();
    }); 
});