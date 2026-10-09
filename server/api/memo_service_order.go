package api

import (
	"context"
	stderrors "errors"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	apipb "github.com/usememos/memos/proto/gen/api"
	"github.com/usememos/memos/store"
)

// MoveMemo repositions an owned, active top-level memo in the caller's timeline.
func (s *APIService) MoveMemo(ctx context.Context, request *apipb.MoveMemoRequest) (*apipb.MoveMemoResponse, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user")
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}
	uid, err := ExtractMemoUIDFromName(request.Name)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid memo name")
	}
	move := &store.MoveMemo{ActorID: user.ID, UID: uid}
	if request.Before != nil {
		before, err := ExtractMemoUIDFromName(*request.Before)
		if err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "invalid before memo name")
		}
		move.Before = &before
	}
	if request.After != nil {
		after, err := ExtractMemoUIDFromName(*request.After)
		if err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "invalid after memo name")
		}
		move.After = &after
	}
	if err := s.Store.MoveMemo(ctx, move); err != nil {
		switch {
		case stderrors.Is(err, store.ErrMemoOrderPermission):
			return nil, status.Errorf(codes.PermissionDenied, "memo is outside the caller's timeline")
		case stderrors.Is(err, store.ErrMemoOrderConflict):
			return nil, status.Errorf(codes.Aborted, "memo order changed; reload and try again")
		default:
			return nil, status.Errorf(codes.Internal, "failed to move memo: %v", err)
		}
	}
	memo, err := s.GetMemo(ctx, &apipb.GetMemoRequest{Name: request.Name})
	if err != nil {
		return nil, err
	}
	s.SSEHub.publishMemoChanged()
	return &apipb.MoveMemoResponse{Memo: memo}, nil
}
