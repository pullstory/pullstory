/* 응원과 댓글 — 하루(/p/) · 글(/n/) · 책(/book/)이 함께 쓴다.
   읽는 화면 셋에 같은 것을 세 번 쓰지 않으려고 한 곳에 뒀다.
   쓰는 쪽에서 PS.reactions(el, {targetId, ownerUid}) 만 부르면 된다. */
(function () {
  var PS = (window.PS = window.PS || {});

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function when(ms) {
    var t = new Date(ms || Date.now());
    var now = new Date();
    var sameYear = t.getFullYear() === now.getFullYear();
    return (sameYear ? '' : t.getFullYear() + '. ') + (t.getMonth() + 1) + '. ' + t.getDate() + '.';
  }
  function login() {
    return firebase.auth().signInWithPopup(new firebase.auth.GoogleAuthProvider())
      .catch(function (e) { alert('로그인이 안 됐어요: ' + e.message); });
  }

  PS.reactions = function (host, opts) {
    if (!host || !opts || !opts.targetId) return;
    var db = firebase.firestore();
    var targetId = opts.targetId;
    var ownerUid = opts.ownerUid || null;

    var me = null;          // 로그인한 사람
    var myProfile = null;   // 필명·핸들
    var cheered = false;
    var cheerN = 0;
    var busy = false;
    var comments = [];

    host.className = 'rx';
    host.innerHTML =
      '<button class="cheer" type="button"><i>♡</i><span>응원</span> <b></b></button>' +
      '<div class="rx-h"><b>Comments</b><u></u></div>' +
      '<div class="cm-list"></div>' +
      '<div class="cm-new">' +
        '<textarea placeholder="읽고 남기는 말"></textarea>' +
        '<div class="row"><span></span><button type="button">남기기</button></div>' +
      '</div>';

    var btn = host.querySelector('.cheer');
    var list = host.querySelector('.cm-list');
    var box = host.querySelector('.cm-new textarea');
    var send = host.querySelector('.cm-new button');
    var hint = host.querySelector('.cm-new .row span');

    function paintCheer() {
      btn.classList.toggle('on', cheered);
      btn.querySelector('i').textContent = cheered ? '♥' : '♡';
      btn.querySelector('b').textContent = cheerN > 0 ? cheerN : '';
      btn.disabled = busy;
    }

    function paintComments() {
      if (!comments.length) {
        list.innerHTML = '<p class="cm-none">아직 남긴 말이 없습니다.</p>';
        return;
      }
      list.innerHTML = comments.map(function (c) {
        var mine = me && (c.uid === me.uid || (ownerUid && me.uid === ownerUid));
        var name = esc(c.penName || c.handle || '읽은 사람');
        // 핸들이 있으면 그 사람 책장으로 — 남긴 말에서 그 사람의 글로 건너간다
        var who = c.handle
          ? '<a class="who" href="/u/' + encodeURIComponent(c.handle) + '">' + name + '</a>'
          : '<span class="who">' + name + '</span>';
        return '<div class="cm" data-id="' + esc(c.id) + '">' +
          '<div class="top">' +
            who +
            '<span class="at">' + when(c.at) + '</span>' +
            (mine ? '<button class="del" type="button">지우기</button>' : '') +
          '</div>' +
          '<div class="body">' + esc(c.body || '') + '</div>' +
        '</div>';
      }).join('');
      Array.prototype.forEach.call(list.querySelectorAll('.del'), function (b) {
        b.addEventListener('click', function () {
          var id = b.closest('.cm').getAttribute('data-id');
          if (!confirm('이 말을 지울까요?')) return;
          db.collection('comments').doc(id).delete()
            .then(function () { comments = comments.filter(function (x) { return x.id !== id; }); paintComments(); })
            .catch(function (e) { alert('지우지 못했어요: ' + e.message); });
        });
      });
    }

    function paintForm() {
      if (me) {
        hint.textContent = '';
        send.textContent = '남기기';
        box.disabled = false;
      } else {
        hint.textContent = '로그인하면 남길 수 있어요';
        send.textContent = '로그인';
        box.disabled = true;
      }
    }

    function loadCheers() {
      db.collection('cheers').where('targetId', '==', targetId).get()
        .then(function (s) {
          cheerN = s.size;
          cheered = !!(me && s.docs.some(function (d) { return d.data().uid === me.uid; }));
          paintCheer();
        })
        .catch(function (e) { console.warn('cheers:', e); });
    }

    function loadComments() {
      db.collection('comments').where('targetId', '==', targetId).get()
        .then(function (s) {
          comments = s.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
          comments.sort(function (a, b) { return (a.at || 0) - (b.at || 0); });
          paintComments();
        })
        .catch(function (e) { console.warn('comments:', e); list.innerHTML = ''; });
    }

    btn.addEventListener('click', function () {
      if (busy) return;
      if (!me) { login(); return; }
      busy = true;
      var next = !cheered;
      cheered = next; cheerN += next ? 1 : -1;
      paintCheer();                                   // 먼저 반응하고 저장은 뒤따른다
      var ref = db.collection('cheers').doc(me.uid + '_' + targetId);
      (next ? ref.set({ uid: me.uid, targetId: targetId, at: Date.now() }) : ref.delete())
        .then(function () { busy = false; paintCheer(); })
        .catch(function (e) {
          cheered = !next; cheerN += next ? -1 : 1; busy = false; paintCheer();
          alert('잘 안 됐어요: ' + e.message);
        });
    });

    send.addEventListener('click', function () {
      if (!me) { login(); return; }
      var body = (box.value || '').trim();
      if (!body) return;
      send.disabled = true;
      db.collection('comments').add({
        targetId: targetId,
        targetUrl: location.pathname,          // 앱에서 이 자리로 되짚어 갈 때 쓴다
        targetOwnerUid: ownerUid || null,
        uid: me.uid,
        handle: (myProfile && myProfile.handle) || '',
        penName: (myProfile && myProfile.penName) || me.displayName || '읽은 사람',
        body: body.slice(0, 1000),
        at: Date.now()
      })
        .then(function () { box.value = ''; send.disabled = false; loadComments(); })
        .catch(function (e) { send.disabled = false; alert('남기지 못했어요: ' + e.message); });
    });

    firebase.auth().onAuthStateChanged(function (u) {
      me = u || null;
      myProfile = null;
      paintForm();
      paintCheer();
      paintComments();
      if (u) {
        db.collection('users').doc(u.uid).get()
          .then(function (s) { if (s.exists) myProfile = s.data(); })
          .catch(function () {});
      }
      loadCheers();
    });

    loadComments();
  };
})();
