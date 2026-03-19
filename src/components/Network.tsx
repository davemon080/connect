import React, { useState, useEffect } from 'react';
import { collection, getDocs, addDoc, query, where, updateDoc, doc, deleteDoc, onSnapshot, orderBy, limit, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { UserProfile, FriendRequest, Connection, Post } from '../types';
import { Link, useNavigate } from 'react-router-dom';
import { Search, MapPin, Briefcase, Star, MessageSquare, UserPlus, Users, Bell, Check, X, Sparkles, TrendingUp } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface NetworkProps {
  profile: UserProfile;
}

export default function Network({ profile }: NetworkProps) {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [highlights, setHighlights] = useState<Post[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [showRequests, setShowRequests] = useState(false);
  const [activeTab, setActiveTab] = useState<'suggested' | 'discover'>('suggested');
  const navigate = useNavigate();

  useEffect(() => {
    const fetchData = async () => {
      // Fetch all users
      const usersSnapshot = await getDocs(collection(db, 'users'));
      const allUsers = usersSnapshot.docs
        .map(doc => doc.data() as UserProfile)
        .filter(u => u.uid !== profile.uid);
      setUsers(allUsers);

      // Fetch highlights (recent posts)
      const postsQuery = query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(10));
      const postsSnapshot = await getDocs(postsQuery);
      setHighlights(postsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Post)));

      setLoading(false);
    };

    fetchData();

    // Listen for friend requests
    const requestsQuery = query(collection(db, 'friendRequests'), where('toUid', '==', profile.uid), where('status', '==', 'pending'));
    const unsubscribeRequests = onSnapshot(requestsQuery, (snapshot) => {
      setFriendRequests(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as FriendRequest)));
    });

    // Listen for connections
    const connectionsQuery = query(collection(db, 'connections'), where('uids', 'array-contains', profile.uid));
    const unsubscribeConnections = onSnapshot(connectionsQuery, (snapshot) => {
      setConnections(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Connection)));
    });

    return () => {
      unsubscribeRequests();
      unsubscribeConnections();
    };
  }, [profile.uid]);

  const sendFriendRequest = async (targetUser: UserProfile) => {
    // Check if already sent or connected
    const alreadyConnected = connections.some(c => c.uids.includes(targetUser.uid));
    if (alreadyConnected) return;

    // Check if there's already a pending request (either way)
    const outgoingQuery = query(
      collection(db, 'friendRequests'), 
      where('fromUid', '==', profile.uid), 
      where('toUid', '==', targetUser.uid),
      where('status', '==', 'pending')
    );
    const incomingQuery = query(
      collection(db, 'friendRequests'), 
      where('fromUid', '==', targetUser.uid), 
      where('toUid', '==', profile.uid),
      where('status', '==', 'pending')
    );

    const [outgoingSnap, incomingSnap] = await Promise.all([
      getDocs(outgoingQuery),
      getDocs(incomingQuery)
    ]);

    if (!outgoingSnap.empty || !incomingSnap.empty) return;

    await addDoc(collection(db, 'friendRequests'), {
      fromUid: profile.uid,
      fromName: profile.displayName,
      fromPhoto: profile.photoURL,
      toUid: targetUser.uid,
      status: 'pending',
      createdAt: new Date().toISOString()
    });

    navigate('/requests');
  };

  const acceptRequest = async (request: FriendRequest) => {
    const timestamp = new Date().toISOString();
    
    // Update request status
    await updateDoc(doc(db, 'friendRequests', request.id), { status: 'accepted' });

    // Create connection
    await addDoc(collection(db, 'connections'), {
      uids: [profile.uid, request.fromUid],
      createdAt: timestamp
    });

    // Initialize activeChats for both users so they appear in each other's chat list
    const chatRef1 = doc(db, 'users', profile.uid, 'activeChats', request.fromUid);
    const chatRef2 = doc(db, 'users', request.fromUid, 'activeChats', profile.uid);
    
    await setDoc(chatRef1, { 
      lastMessage: 'You are now connected! Say hi.', 
      updatedAt: timestamp 
    }, { merge: true });
    
    await setDoc(chatRef2, { 
      lastMessage: 'You are now connected! Say hi.', 
      updatedAt: timestamp 
    }, { merge: true });
  };

  const rejectRequest = async (request: FriendRequest) => {
    await updateDoc(doc(db, 'friendRequests', request.id), { status: 'rejected' });
  };

  // Algorithm: Suggest users based on skills, university, or opposite role
  const suggestedUsers = users
    .filter(u => !connections.some(c => c.uids.includes(u.uid)))
    .map(u => {
      let score = 0;
      // Skill match
      const commonSkills = u.skills?.filter(s => profile.skills?.includes(s)) || [];
      score += commonSkills.length * 15;
      
      // Opposite role (Freelancer <-> Client) - Higher priority for networking
      if (u.role !== profile.role) score += 25;
      
      // Same university - Strong connection point
      if (u.education?.university && u.education?.university === profile.education?.university) {
        score += 30;
      }
      
      // Same location
      if (u.location && u.location === profile.location) score += 10;
      
      return { ...u, score };
    })
    .sort((a, b) => b.score - a.score);

  const filteredUsers = suggestedUsers.filter(u => 
    u.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.skills?.some(s => s.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="max-w-7xl mx-auto space-y-8 pb-12">
      {/* Header & Search */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-white p-6 rounded-3xl border border-gray-100 shadow-sm relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-teal-500/5 rounded-full -mr-16 -mt-16 blur-3xl" />
        
        <div className="flex items-center gap-4 relative z-10">
          <div className="p-3 bg-teal-600 rounded-2xl shadow-lg shadow-teal-100">
            <Users className="text-white" size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Network Hub</h1>
            <p className="text-gray-500 text-xs font-medium">Expand your professional circle</p>
          </div>
        </div>

        <div className="flex items-center gap-3 relative z-10">
          <div className="relative flex-1 md:w-80">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input
              type="text"
              placeholder="Search by name or skills..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-11 pr-4 py-2.5 bg-gray-50 border-transparent focus:bg-white focus:ring-2 focus:ring-teal-500 rounded-xl text-sm transition-all border border-gray-100"
            />
          </div>
          
          <Link 
            to="/requests"
            className="relative p-2.5 rounded-xl transition-all border bg-white border-gray-100 hover:border-teal-200 text-gray-600 hover:text-teal-600"
            title="Friend Requests"
          >
            <UserPlus size={20} />
            {friendRequests.length > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-[10px] font-bold flex items-center justify-center rounded-full border-2 border-white">
                {friendRequests.length}
              </span>
            )}
          </Link>
        </div>
      </div>

      {/* Main Content Tabs */}
      <div className="flex items-center gap-6 border-b border-gray-100 pb-1">
        <button 
          onClick={() => setActiveTab('suggested')}
          className={`pb-4 text-sm font-bold transition-all relative ${activeTab === 'suggested' ? 'text-teal-600' : 'text-gray-400 hover:text-gray-600'}`}
        >
          <div className="flex items-center gap-2">
            <Sparkles size={16} />
            Suggested for You
          </div>
          {activeTab === 'suggested' && <motion.div layoutId="tab" className="absolute bottom-0 left-0 right-0 h-1 bg-teal-600 rounded-full" />}
        </button>
        <button 
          onClick={() => setActiveTab('discover')}
          className={`pb-4 text-sm font-bold transition-all relative ${activeTab === 'discover' ? 'text-teal-600' : 'text-gray-400 hover:text-gray-600'}`}
        >
          <div className="flex items-center gap-2">
            <TrendingUp size={16} />
            Discover Highlights
          </div>
          {activeTab === 'discover' && <motion.div layoutId="tab" className="absolute bottom-0 left-0 right-0 h-1 bg-teal-600 rounded-full" />}
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center p-12"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-600"></div></div>
      ) : activeTab === 'suggested' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredUsers.map((user) => (
            <motion.div
              key={user.uid}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-2xl border border-gray-100 p-4 hover:border-teal-200 hover:shadow-xl hover:shadow-teal-900/5 transition-all group relative"
            >
              <div className="flex items-start gap-4">
                <Link to={`/profile/${user.uid}`} className="relative shrink-0">
                  <img 
                    src={user.photoURL} 
                    alt={user.displayName} 
                    className="w-16 h-16 rounded-2xl object-cover shadow-sm group-hover:scale-105 transition-transform duration-300" 
                  />
                  {user.score > 30 && (
                    <div className="absolute -top-1 -right-1 p-1 bg-amber-400 text-white rounded-lg shadow-sm">
                      <Star size={10} fill="currentColor" />
                    </div>
                  )}
                </Link>
                
                <div className="flex-1 min-w-0">
                  <Link to={`/profile/${user.uid}`} className="block font-bold text-gray-900 hover:text-teal-600 transition-colors truncate text-sm">
                    {user.displayName}
                  </Link>
                  <p className="text-[11px] font-medium text-teal-600 uppercase tracking-wider mb-1">
                    {user.role}
                  </p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {user.skills?.slice(0, 2).map(skill => (
                      <span key={skill} className="px-1.5 py-0.5 bg-gray-50 text-gray-500 text-[9px] font-bold rounded-md border border-gray-100">
                        {skill}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 mt-4">
                <button 
                  onClick={() => sendFriendRequest(user)}
                  disabled={friendRequests.some(r => r.toUid === user.uid) || connections.some(c => c.uids.includes(user.uid))}
                  className={`py-2 px-3 font-bold text-[11px] rounded-xl transition-all flex items-center justify-center gap-1.5 ${
                    friendRequests.some(r => r.toUid === user.uid)
                      ? 'bg-gray-50 text-gray-400 cursor-not-allowed'
                      : connections.some(c => c.uids.includes(user.uid))
                      ? 'bg-teal-50 text-teal-600 cursor-default'
                      : 'bg-teal-600 hover:bg-teal-700 text-white shadow-md shadow-teal-100'
                  }`}
                >
                  {connections.some(c => c.uids.includes(user.uid)) ? (
                    <>
                      <Check size={12} />
                      Connected
                    </>
                  ) : friendRequests.some(r => r.toUid === user.uid) ? (
                    'Pending'
                  ) : (
                    <>
                      <UserPlus size={12} />
                      Connect
                    </>
                  )}
                </button>
                <Link
                  to={`/messages?uid=${user.uid}`}
                  className="py-2 px-3 bg-gray-50 hover:bg-teal-50 text-gray-600 hover:text-teal-600 font-bold text-[11px] rounded-xl transition-all flex items-center justify-center gap-1.5 border border-transparent hover:border-teal-100"
                >
                  <MessageSquare size={12} />
                  Message
                </Link>
              </div>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {highlights.map(post => (
            <motion.div
              key={post.id}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden hover:shadow-md transition-all"
            >
              <div className="p-4 flex items-center gap-3 border-b border-gray-50">
                <img src={post.authorPhoto} className="w-10 h-10 rounded-xl object-cover" alt="" />
                <div>
                  <p className="font-bold text-gray-900 text-sm">{post.authorName}</p>
                  <p className="text-[10px] text-gray-400 uppercase tracking-wider font-bold">Recent Highlight</p>
                </div>
              </div>
              <div className="p-4">
                <p className="text-gray-600 text-sm line-clamp-3 mb-4">{post.content}</p>
                {post.imageUrl && (
                  <img src={post.imageUrl} className="w-full h-48 object-cover rounded-2xl mb-4" alt="" />
                )}
                <Link 
                  to={`/profile/${post.authorUid}`}
                  className="inline-flex items-center gap-2 text-teal-600 font-bold text-xs hover:gap-3 transition-all"
                >
                  View Portfolio
                  <TrendingUp size={14} />
                </Link>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
