import { 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  query, 
  where, 
  orderBy, 
  addDoc, 
  onSnapshot,
  serverTimestamp,
  Timestamp,
  limit,
  or,
  and,
  getDocFromServer,
  updateDoc,
  deleteDoc
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, auth, storage } from '../firebase';
import { UserProfile, Post, Job, Message, Proposal, Attachment, FriendRequest } from '../types';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export const firebaseService = {
  // Test connection
  async testConnection() {
    try {
      await getDocFromServer(doc(db, 'test', 'connection'));
    } catch (error) {
      if(error instanceof Error && error.message.includes('the client is offline')) {
        console.error("Please check your Firebase configuration. ");
      }
    }
  },

  // User Profile
  async getUserProfile(uid: string): Promise<UserProfile | null> {
    const path = `users/${uid}`;
    try {
      const docRef = doc(db, 'users', uid);
      const docSnap = await getDoc(docRef);
      return docSnap.exists() ? (docSnap.data() as UserProfile) : null;
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, path);
      return null;
    }
  },

  async createUserProfile(profile: UserProfile): Promise<void> {
    const path = `users/${profile.uid}`;
    try {
      await setDoc(doc(db, 'users', profile.uid), profile);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  },

  async updateUserProfile(uid: string, data: Partial<UserProfile>): Promise<void> {
    const path = `users/${uid}`;
    try {
      await setDoc(doc(db, 'users', uid), data, { merge: true });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  },

  // Posts
  async createPost(post: Omit<Post, 'id' | 'createdAt'>): Promise<void> {
    const path = 'posts';
    try {
      await addDoc(collection(db, 'posts'), {
        ...post,
        createdAt: new Date().toISOString()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  },

  subscribeToPosts(callback: (posts: Post[]) => void) {
    const path = 'posts';
    const q = query(collection(db, 'posts'), orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snapshot) => {
      const posts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Post));
      callback(posts);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    });
  },

  // Jobs
  async createJob(job: Omit<Job, 'id' | 'createdAt' | 'status'>): Promise<void> {
    const path = 'jobs';
    try {
      await addDoc(collection(db, 'jobs'), {
        ...job,
        status: 'open',
        createdAt: new Date().toISOString()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  },

  subscribeToJobs(callback: (jobs: Job[]) => void) {
    const path = 'jobs';
    const q = query(collection(db, 'jobs'), orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snapshot) => {
      const jobs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Job));
      callback(jobs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    });
  },

  // Messages
  async uploadFile(file: File, folder: string = 'chat_attachments'): Promise<Attachment> {
    const fileRef = ref(storage, `${folder}/${Date.now()}_${file.name}`);
    await uploadBytes(fileRef, file);
    const url = await getDownloadURL(fileRef);
    return {
      name: file.name,
      url,
      type: file.type,
      size: file.size
    };
  },

  async sendMessage(message: Omit<Message, 'id' | 'createdAt'>): Promise<void> {
    const timestamp = new Date().toISOString();
    const path = 'messages';
    
    // Clean up message object to remove undefined fields
    const cleanMessage: any = {
      senderUid: message.senderUid,
      receiverUid: message.receiverUid,
      content: message.content,
      createdAt: timestamp
    };
    
    if (message.attachments && message.attachments.length > 0) {
      cleanMessage.attachments = message.attachments;
    }

    try {
      await addDoc(collection(db, 'messages'), cleanMessage);
      
      // Update active chats for both users
      const chatRef1 = doc(db, 'users', message.senderUid, 'activeChats', message.receiverUid);
      const chatRef2 = doc(db, 'users', message.receiverUid, 'activeChats', message.senderUid);
      
      const lastMessageText = message.content || (message.attachments && message.attachments.length > 0 ? '📎 Attachment' : '');
      
      await setDoc(chatRef1, { lastMessage: lastMessageText, updatedAt: timestamp }, { merge: true });
      await setDoc(chatRef2, { lastMessage: lastMessageText, updatedAt: timestamp }, { merge: true });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  },

  subscribeToMessages(uid: string, otherUid: string, callback: (messages: Message[]) => void, onError?: (error: any) => void) {
    const path = 'messages';
    const q = query(
      collection(db, 'messages'),
      or(
        and(where('senderUid', '==', uid), where('receiverUid', '==', otherUid)),
        and(where('senderUid', '==', otherUid), where('receiverUid', '==', uid))
      ),
      orderBy('createdAt', 'asc'),
      limit(100)
    );
    
    return onSnapshot(q, (snapshot) => {
      const messages = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Message));
      callback(messages);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
      if (onError) onError(error);
    });
  },

  // Profile cache to avoid redundant fetches
  profileCache: new Map<string, UserProfile>(),

  subscribeToActiveChats(uid: string, callback: (chats: any[]) => void, onError?: (error: any) => void) {
    if (!uid) {
      callback([]);
      return () => {};
    }

    const path = `users/${uid}/activeChats`;
    const q = query(
      collection(db, 'users', uid, 'activeChats'), 
      orderBy('updatedAt', 'desc'),
      limit(50)
    );
    
    return onSnapshot(q, (snapshot) => {
      if (snapshot.empty) {
        callback([]);
        return;
      }

      const fetchProfiles = async () => {
        try {
          const chatPromises = snapshot.docs.map(async (chatDoc) => {
            const otherUid = chatDoc.id;
            const chatData = chatDoc.data();
            
            try {
              let userProfile = this.profileCache.get(otherUid);
              if (!userProfile) {
                userProfile = await this.getUserProfile(otherUid);
                if (userProfile) {
                  this.profileCache.set(otherUid, userProfile);
                }
              }
              
              if (!userProfile) return null;

              return {
                ...chatData,
                otherUid,
                user: userProfile
              };
            } catch (e) {
              return null;
            }
          });

          const chats = await Promise.all(chatPromises);
          const validChats = chats.filter((c): c is any => c !== null);
          callback(validChats);
        } catch (e) {
          if (onError) onError(e);
        }
      };
      
      fetchProfiles();
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
      if (onError) onError(error);
    });
  },

  // Friend Requests
  subscribeToIncomingFriendRequests(uid: string, callback: (requests: FriendRequest[]) => void) {
    const path = 'friendRequests';
    const q = query(
      collection(db, 'friendRequests'),
      where('toUid', '==', uid),
      orderBy('createdAt', 'desc')
    );
    return onSnapshot(q, (snapshot) => {
      const requests = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as FriendRequest));
      callback(requests);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    });
  },

  subscribeToOutgoingFriendRequests(uid: string, callback: (requests: FriendRequest[]) => void) {
    const path = 'friendRequests';
    const q = query(
      collection(db, 'friendRequests'),
      where('fromUid', '==', uid),
      orderBy('createdAt', 'desc')
    );
    return onSnapshot(q, (snapshot) => {
      const requests = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as FriendRequest));
      callback(requests);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    });
  },

  async deleteFriendRequest(requestId: string): Promise<void> {
    const path = `friendRequests/${requestId}`;
    try {
      await deleteDoc(doc(db, 'friendRequests', requestId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  },

  async acceptFriendRequest(request: FriendRequest, myProfile: UserProfile): Promise<void> {
    const timestamp = new Date().toISOString();
    const path = `friendRequests/${request.id}`;
    
    try {
      // Update request status
      await updateDoc(doc(db, 'friendRequests', request.id), { status: 'accepted' });

      // Create connection
      await addDoc(collection(db, 'connections'), {
        uids: [myProfile.uid, request.fromUid],
        createdAt: timestamp
      });

      // Initialize activeChats for both users
      const chatRef1 = doc(db, 'users', myProfile.uid, 'activeChats', request.fromUid);
      const chatRef2 = doc(db, 'users', request.fromUid, 'activeChats', myProfile.uid);
      
      await setDoc(chatRef1, { 
        lastMessage: 'You are now connected! Say hi.', 
        updatedAt: timestamp 
      }, { merge: true });
      
      await setDoc(chatRef2, { 
        lastMessage: 'You are now connected! Say hi.', 
        updatedAt: timestamp 
      }, { merge: true });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  },

  async rejectFriendRequest(requestId: string): Promise<void> {
    const path = `friendRequests/${requestId}`;
    try {
      await updateDoc(doc(db, 'friendRequests', requestId), { status: 'rejected' });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  },

  // Client Job Management
  subscribeToClientJobs(clientUid: string, callback: (jobs: Job[]) => void) {
    const path = 'jobs';
    const q = query(
      collection(db, 'jobs'),
      where('clientUid', '==', clientUid),
      orderBy('createdAt', 'desc')
    );
    return onSnapshot(q, (snapshot) => {
      const jobs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Job));
      callback(jobs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    });
  },

  async updateJobStatus(jobId: string, status: 'open' | 'closed'): Promise<void> {
    const path = `jobs/${jobId}`;
    try {
      await updateDoc(doc(db, 'jobs', jobId), { status });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  },

  async deleteJob(jobId: string): Promise<void> {
    const path = `jobs/${jobId}`;
    try {
      await deleteDoc(doc(db, 'jobs', jobId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  },

  // Proposals for a specific job
  subscribeToJobProposals(jobId: string, callback: (proposals: Proposal[]) => void) {
    const path = 'proposals';
    const q = query(
      collection(db, 'proposals'),
      where('jobId', '==', jobId),
      orderBy('createdAt', 'desc')
    );
    return onSnapshot(q, (snapshot) => {
      const proposals = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Proposal));
      callback(proposals);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    });
  },

  // Proposals
  async createProposal(proposal: Omit<Proposal, 'id' | 'createdAt' | 'status'>): Promise<void> {
    const path = 'proposals';
    try {
      await addDoc(collection(db, 'proposals'), {
        ...proposal,
        status: 'pending',
        createdAt: new Date().toISOString()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  }
};

firebaseService.testConnection();
